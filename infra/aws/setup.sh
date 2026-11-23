#!/bin/bash
# One-time AWS setup. Run from the repo root on a machine signed in to AWS and GitHub:
#   bash infra/aws/setup.sh                         # free address <ip>.sslip.io
#   DOMAIN=vouchers.example.edu.in bash infra/aws/setup.sh
# Optional: REGION (default ap-south-1), STACK (default stmarys-vouchers), INSTANCE_TYPE (default t3.small).
#
# Creates the CloudFormation stack (infra/aws/stack.yml), then stores its outputs as GitHub
# repository variables so the "Test and deploy" workflow can deploy. Safe to re-run (updates in place).
set -euo pipefail
REGION="${REGION:-ap-south-1}"
STACK="${STACK:-stmarys-vouchers}"
DOMAIN="${DOMAIN:-}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
REPO="${REPO:-Ram-9177/stmarys-accounts}"
cd "$(dirname "$0")/../.."

command -v aws >/dev/null || { echo "Install the AWS CLI first: brew install awscli"; exit 1; }
command -v gh >/dev/null || { echo "Install the GitHub CLI first: brew install gh"; exit 1; }
ACCOUNT=$(aws sts get-caller-identity --query Account --output text) || { echo "Sign in to AWS first: aws configure sso  (or aws configure)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login"; exit 1; }
echo "AWS account $ACCOUNT, region $REGION, stack $STACK, domain ${DOMAIN:-<free sslip.io address>}"

OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then CREATE_OIDC=false; else CREATE_OIDC=true; fi

aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK" \
  --template-file infra/aws/stack.yml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "DomainName=${DOMAIN}" \
    "InstanceType=${INSTANCE_TYPE}" \
    "GitHubRepo=${REPO}" \
    "CreateGitHubOidcProvider=${CREATE_OIDC}"

out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
SITE_URL=$(out SiteUrl)

gh variable set AWS_REGION --repo "$REPO" --body "$REGION"
gh variable set AWS_DEPLOY_ROLE_ARN --repo "$REPO" --body "$(out DeployRoleArn)"
gh variable set ECR_REPOSITORY_URI --repo "$REPO" --body "$(out EcrRepositoryUri)"
gh variable set EC2_INSTANCE_ID --repo "$REPO" --body "$(out InstanceId)"
gh variable set SITE_URL --repo "$REPO" --body "$SITE_URL"

cat <<EOF

Stack ready.
  Site URL    : $SITE_URL
  Elastic IP  : $(out ElasticIp)
  Backups     : s3://$(out BackupBucketName)/postgres
EOF
if [ -n "$DOMAIN" ]; then
  echo "  DNS         : create an A record  $DOMAIN -> $(out ElasticIp)  (HTTPS starts once it resolves)"
fi
echo
echo "Next: start the first deploy with"
echo "  gh workflow run deploy.yml --repo $REPO --ref aws-typescript-rewrite"
