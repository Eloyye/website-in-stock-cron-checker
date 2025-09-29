import { SESClient, SendEmailCommand, type SendEmailCommandOutput } from "@aws-sdk/client-ses";
import {type Cheerio, type CheerioAPI, load} from "cheerio";

// Environment variable validation with security
interface ValidatedConfig {
  region: string;
  targetUrl: string;
  toEmail: string;
  fromEmail: string;
}

function validateEnvironment(): ValidatedConfig {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const targetUrl = process.env.TARGET_URL;
  const toEmail = process.env.TO_EMAIL;
  const fromEmail = process.env.FROM_EMAIL;

  if (!targetUrl) {
    throw new Error("TARGET_URL environment variable is required");
  }

  if (!toEmail || !fromEmail) {
    throw new Error("TO_EMAIL and FROM_EMAIL environment variables are required");
  }

  // Validate URL format
  try {
    new URL(targetUrl);
  } catch {
    throw new Error("TARGET_URL must be a valid URL");
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(toEmail)) {
    throw new Error("TO_EMAIL must be a valid email address");
  }
  if (!emailRegex.test(fromEmail)) {
    throw new Error("FROM_EMAIL must be a valid email address");
  }

  return {
    region,
    targetUrl,
    toEmail,
    fromEmail,
  };
}

// Initialize configuration with validation
let config: ValidatedConfig;
let ses: SESClient;

try {
  config = validateEnvironment();
  ses = new SESClient({
    region: config.region,
    maxAttempts: 3, // Retry configuration
  });
} catch (error) {
  console.error("Environment validation failed:", error);
  throw error;
}

type CheckResult = {
  exists: boolean;
  text: string;
  saysAddToCart: boolean;
  locked: boolean;
};

type HandlerSuccess = { ok: true; notified: boolean } & CheckResult;

type HandlerFetchFail = { ok: false; message: string };

type HandlerError = { ok: false; error: string };

export type HandlerResponse = HandlerSuccess | HandlerFetchFail | HandlerError;

function isElementLocked($: CheerioAPI, el: Cheerio<any>): boolean {
  if (!el || el.length === 0) return true;
  // Disabled attribute or aria-disabled
  const hasDisabledAttr = el.is(":disabled") || el.attr("disabled") != null;
  const ariaDisabled = (el.attr("aria-disabled") || "").toString().toLowerCase() === "true";
  // Common class names that indicate lock/disable
  const classStr = (el.attr("class") || "").toLowerCase();
  const classIndicatesLocked = ["disabled", "soldout", "locked", "unavailable"].some((c) => classStr.includes(c));
  // Data attributes sometimes used by shops
  const dataLocked = (el.attr("data-locked") || "").toString().toLowerCase() === "true";
  return hasDisabledAttr || ariaDisabled || classIndicatesLocked || dataLocked;
}

async function sendEmail(subject: string, html: string): Promise<SendEmailCommandOutput> {
  const cmd = new SendEmailCommand({
    Destination: { ToAddresses: [config.toEmail] },
    Message: {
      Body: { Html: { Charset: "UTF-8", Data: html } },
      Subject: { Charset: "UTF-8", Data: subject },
    },
    Source: config.fromEmail,
  });

  try {
    const result = await ses.send(cmd);
    console.log(`Email sent successfully. MessageId: ${result.MessageId}`);
    return result;
  } catch (error) {
    console.error("Failed to send email:", error);
    throw error;
  }
}

export const handler = async (event?: any): Promise<HandlerResponse> => {
  const executionId = event?.source || `execution-${Date.now()}`;
  const start = Date.now();

  console.log(`Starting stock check execution: ${executionId}`);
  console.log(`Target URL: ${config.targetUrl}`);

  try {
    // Enhanced fetch with proper error handling and timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout

    const res = await fetch(config.targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StockChecker/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const msg = `HTTP ${res.status} ${res.statusText} when fetching ${config.targetUrl}`;
      console.error(msg);

      // Send error notification for non-2xx responses
      if (res.status >= 500) {
        try {
          await sendEmail(
            "Stock check: Server error detected",
            `<p>Server error while checking stock:</p>
             <p><strong>Status:</strong> ${res.status} ${res.statusText}</p>
             <p><strong>URL:</strong> <a href="${config.targetUrl}">${config.targetUrl}</a></p>
             <p><strong>Time:</strong> ${new Date().toISOString()}</p>`
          );
        } catch (emailError) {
          console.error("Failed to send error notification:", emailError);
        }
      }

      return { ok: false, message: msg };
    }

    const html = await res.text();

    if (!html || html.trim().length === 0) {
      const msg = "Received empty response from target URL";
      console.error(msg);
      return { ok: false, message: msg };
    }

    const $: CheerioAPI = load(html);
    const addEl = $("#add");
    const exists = addEl.length > 0;
    const text = exists ? addEl.text().trim() : "";
    const saysAddToCart = /add\s*to\s*cart/i.test(text);
    const locked = isElementLocked($, addEl);

    const result: CheckResult = { exists, text, saysAddToCart, locked };

    console.log("Stock check result:", {
      ...result,
      executionId,
      targetUrl: config.targetUrl,
      timestamp: new Date().toISOString(),
    });

    // Enhanced stock available detection
    if (exists && saysAddToCart && !locked) {
      const subject = "🎉 Item In Stock Alert - Add to Cart Available!";
      const body = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #28a745;">✅ Stock Available!</h2>
          <p>Great news! The item you're monitoring is now available for purchase.</p>

          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>🔗 Product URL:</strong><br>
               <a href="${config.targetUrl}" style="color: #007bff; text-decoration: none;">${config.targetUrl}</a>
            </p>
            <p><strong>🛒 Button Status:</strong> ${text}</p>
            <p><strong>⏰ Detected At:</strong> ${new Date().toLocaleString()}</p>
          </div>

          <p style="margin-top: 20px;">
            <a href="${config.targetUrl}"
               style="background-color: #28a745; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              🛒 Buy Now
            </a>
          </p>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #dee2e6;">
          <p style="color: #6c757d; font-size: 12px;">
            This is an automated notification from your stock monitoring service.
            <br>Execution ID: ${executionId}
          </p>
        </div>
      `;

      try {
        await sendEmail(subject, body);
        console.log("Stock available notification sent successfully");
        return { ok: true, notified: true, ...result };
      } catch (emailError) {
        console.error("Failed to send stock notification:", emailError);
        // Still return success for the check itself, but log the email failure
        return { ok: true, notified: false, ...result };
      }
    }

    return { ok: true, notified: false, ...result };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isAbortError = err instanceof Error && err.name === 'AbortError';

    console.error("Critical error in stock check handler:", {
      error: errorMessage,
      isAbortError,
      executionId,
      timestamp: new Date().toISOString(),
    });

    // Send detailed error notification
    try {
      const subject = isAbortError ? "Stock check timeout" : "Stock check system error";
      const body = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc3545;">❌ Stock Check Failed</h2>
          <p>There was an error while checking stock availability.</p>

          <div style="background-color: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Error Type:</strong> ${isAbortError ? 'Timeout' : 'System Error'}</p>
            <p><strong>Error Message:</strong> ${errorMessage}</p>
            <p><strong>Target URL:</strong> ${config.targetUrl}</p>
            <p><strong>Execution ID:</strong> ${executionId}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          </div>

          <p>The system will automatically retry on the next scheduled check.</p>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #dee2e6;">
          <p style="color: #6c757d; font-size: 12px;">
            This is an automated error notification from your stock monitoring service.
          </p>
        </div>
      `;
      await sendEmail(subject, body);
    } catch (emailError) {
      console.error("Failed to send error notification:", emailError);
    }

    return { ok: false, error: errorMessage };

  } finally {
    const duration = Date.now() - start;
    console.log(`Stock check completed: ${executionId}, Duration: ${duration}ms`);

    // Log performance warning if execution is slow
    if (duration > 20000) {
      console.warn(`Slow execution detected: ${duration}ms (threshold: 20000ms)`);
    }
  }
};
