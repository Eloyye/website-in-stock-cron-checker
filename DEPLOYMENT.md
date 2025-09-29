# AWS Lambda Deployment Guide - In Stock Notification

This guide provides step-by-step instructions for securely deploying the in-stock notification Lambda function to AWS.

## Prerequisites

### 1. AWS Account Setup
- Active AWS account with billing configured
- AWS CLI installed and configured
- Sufficient permissions for Lambda, SES, CloudFormation, and IAM operations

### 2. Local Environment
- Node.js 20.x or later
- Bun runtime installed
- Git configured

### 3. AWS CLI Configuration
```bash
aws configure
```
Enter your credentials:
- **Access Key ID**: Your AWS access key
- **Secret Access Key**: Your AWS secret key
- **Default region**: us-east-1 (or your preferred region)
- **Output format**: json

## Security Setup

### 1. IAM User for Deployment

Create a dedicated IAM user with minimal required permissions:

**Required Policies:**
- `AWSLambdaFullAccess`
- `IAMFullAccess`
- `AmazonS3FullAccess`
- `CloudFormationFullAccess`
- `AmazonSESFullAccess`
- `AmazonSQSFullAccess` (for Dead Letter Queue)
- `AmazonSNSFullAccess` (for error notifications)

**Custom Policy for Enhanced Security:**
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "lambda:*",
                "iam:CreateRole",
                "iam:AttachRolePolicy",
                "iam:PutRolePolicy",
                "iam:PassRole",
                "cloudformation:*",
                "s3:*",
                "ses:*",
                "sqs:*",
                "sns:*",
                "logs:*",
                "events:*",
                "xray:*"
            ],
            "Resource": "*"
        }
    ]
}
```

### 2. Amazon SES Configuration

#### Verify Email Addresses
1. Go to AWS SES Console
2. Navigate to "Verified identities"
3. Click "Create identity"
4. Verify both sender and recipient email addresses:
   - **FROM_EMAIL**: The email that will send notifications
   - **TO_EMAIL**: The email that will receive notifications

#### Move Out of Sandbox (Production)
1. In SES Console, go to "Account dashboard"
2. Click "Request production access"
3. Fill out the form explaining your use case
4. Wait for AWS approval (typically 24-48 hours)

## Environment Configuration

### 1. Create Environment File

Create `.env` file in project root (DO NOT commit to git):

```bash
# Required Variables
TARGET_URL=https://vaticpro.com/products/v-sol-pro-16mm?variant=62511728066719
TO_EMAIL=recipient@yourdomain.com
FROM_EMAIL=sender@yourdomain.com
AWS_REGION=us-east-1

# Optional - For local testing
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### 2. Update .gitignore

Ensure `.env` is in your `.gitignore`:
```
.env
.env.local
.env.*.local
```

## Deployment Steps

### 1. Install Dependencies
```bash
bun install
```

### 2. Validate Configuration
Test your environment variables are properly set:
```bash
bun run invoke-local
```

### 3. Deploy to AWS
```bash
# Deploy to production (default)
bun run deploy

# Deploy to specific stage
bun run deploy --stage dev
bun run deploy --stage staging
```

### 4. Verify Deployment

After deployment, check:

**AWS Lambda Console:**
- Function is created: `in-stock-notification-prod-checkStock`
- Environment variables are set correctly
- CloudWatch Events rule is active

**CloudWatch Console:**
- Log group exists: `/aws/lambda/in-stock-notification-prod-checkStock`
- Alarms are created:
  - `in-stock-notification-prod-lambda-errors`
  - `in-stock-notification-prod-lambda-duration`

**SQS Console:**
- Dead Letter Queue exists: `in-stock-notification-prod-dlq`

**SNS Console:**
- Topic exists: `in-stock-notification-prod-errors`
- Email subscription is confirmed

## Post-Deployment Security Checklist

### 1. Test Function
```bash
# Test the deployed function
aws lambda invoke \
  --function-name in-stock-notification-prod-checkStock \
  --payload '{"source": "manual-test"}' \
  response.json

# Check response
cat response.json
```

### 2. Monitor Initial Runs
- Check CloudWatch logs for any errors
- Verify SES sending works correctly
- Confirm scheduling is working

### 3. Set Up Additional Monitoring
- Configure AWS Config rules for compliance
- Set up AWS CloudTrail for API logging
- Review AWS Trusted Advisor recommendations

## Troubleshooting

### Common Issues

**SES Permissions Error:**
- Verify email addresses in SES console
- Check IAM permissions include SES access
- Ensure FROM_EMAIL domain is verified

**Lambda Timeout:**
- Check CloudWatch logs for performance issues
- Consider increasing timeout if needed
- Monitor memory usage

**Scheduling Not Working:**
- Verify timezone settings in CloudWatch Events
- Check cron expression syntax
- Confirm function is enabled

**Dead Letter Queue Messages:**
- Check SQS console for failed executions
- Review CloudWatch logs for error details
- Verify retry configuration

### Debug Commands

```bash
# View function logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/in-stock-notification"

# Get recent log events
aws logs describe-log-streams --log-group-name "/aws/lambda/in-stock-notification-prod-checkStock"

# Check function configuration
aws lambda get-function --function-name in-stock-notification-prod-checkStock
```

## Cost Optimization

### Expected Costs (Monthly)
- **Lambda**: ~$0.01 (4 executions/day)
- **CloudWatch**: ~$0.50 (logs + metrics)
- **SES**: $0.10 per 1,000 emails
- **SQS**: ~$0.01 (DLQ usage)
- **SNS**: ~$0.01 (error notifications)

**Total**: ~$0.63/month

### Cost Monitoring
- Set up AWS Budgets for cost alerts
- Review AWS Cost Explorer monthly
- Monitor CloudWatch usage

## Maintenance

### Regular Tasks
- **Weekly**: Review CloudWatch logs and metrics
- **Monthly**: Check SES reputation and bounce rates
- **Quarterly**: Review and rotate AWS credentials
- **Annually**: Update Lambda runtime and dependencies

### Updates and Rollbacks
```bash
# Update function
bun run deploy

# Rollback if needed
serverless rollback -t TIMESTAMP

# Remove entire stack
bun run remove
```

## Security Best Practices

1. **Credential Management**
   - Use environment variables, never hardcode secrets
   - Rotate AWS credentials regularly
   - Use IAM roles instead of keys when possible

2. **Monitoring**
   - Enable AWS CloudTrail
   - Set up CloudWatch alarms
   - Monitor for unusual activity

3. **Network Security**
   - Lambda runs in AWS-managed VPC by default
   - No inbound network access required
   - HTTPS only for external API calls

4. **Data Protection**
   - Email addresses are the only sensitive data
   - SES provides encryption in transit
   - CloudWatch logs encrypted at rest

## Support and Troubleshooting

For issues with this deployment:
1. Check CloudWatch logs first
2. Verify environment variables
3. Test email sending manually through SES console
4. Review IAM permissions
5. Check AWS service health status

Remember to never commit sensitive information like API keys or email addresses to version control.