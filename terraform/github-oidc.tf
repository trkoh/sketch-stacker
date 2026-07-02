# GitHub Actions OIDC keyless auth.
#
# Lets `terraform plan/apply` (and future ops jobs) run inside GitHub Actions
# without any long-lived AWS keys, so infra work can be driven from anywhere —
# including the Claude mobile app — by just pushing/merging. The security
# boundary is the OIDC trust policy below: only this repo's main branch (apply)
# and pull_request events (plan) can assume the role.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprints. AWS no longer validates these for this provider
  # (it trusts the well-known CA) but the argument is still required.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]

  tags = var.stack_tags
}

data "aws_iam_policy_document" "github_actions_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only main (apply) and pull_request events (plan) of THIS repo may assume
    # the role. Feature-branch pushes and forks get a different `sub` and cannot.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:trkoh/sketch-stacker:ref:refs/heads/main",
        "repo:trkoh/sketch-stacker:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "sketch-stacker-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_actions_trust.json
  tags               = var.stack_tags
}

# Least-privilege policy: only the services this stack's Terraform actually
# manages, instead of AdministratorAccess. Enumerated from the resource types in
# *.tf (S3, Lambda, API Gateway, CloudFront, DynamoDB, Secrets Manager, Logs,
# IAM, STS). Everything else in AWS (EC2, RDS, VPC, ...) is denied by omission.
#
# iam:* is the one broad grant, required because Terraform creates/updates the
# Lambda execution roles and this OIDC role itself. It permits privilege
# escalation in principle, but the OIDC trust above restricts *who* can assume
# this role to this repo's main branch + PRs. Add a permissions boundary later
# to close that gap if desired.
data "aws_iam_policy_document" "github_actions_permissions" {
  statement {
    sid    = "ManageStackServices"
    effect = "Allow"
    actions = [
      "s3:*",
      "lambda:*",
      "apigateway:*",
      "cloudfront:*",
      "dynamodb:*",
      "secretsmanager:*",
      "logs:*",
      "iam:*",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "github_actions" {
  name        = "sketch-stacker-github-actions"
  description = "Least-privilege permissions for the sketch-stacker Terraform CI role"
  policy      = data.aws_iam_policy_document.github_actions_permissions.json
  tags        = var.stack_tags
}

resource "aws_iam_role_policy_attachment" "github_actions" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.github_actions.arn
}

output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions.arn
  description = "IAM role ARN for GitHub Actions OIDC. Set as repo variable AWS_ROLE_ARN."
}
