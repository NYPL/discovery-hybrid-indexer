provider "aws" {
  region     = "us-east-1"
}

variable "environment" {
  type = string
  default = "qa"
  description = "The name of the environnment (qa, production)"

  validation {
    condition     = contains(["qa", "production"], var.environment)

    error_message = "The environmnet must be 'qa' or 'production'."
  }
}

variable "vpc_config" {
  type = map
  description = "The name of the environnment (qa, production)"
}

variable "env_vars" {
  type = map
  description = "A map of environmental variables to attach to the deployed Lambda"
}

# Package the app as a zip:
data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/dist.zip"
  source_dir  = "../../"
  excludes    = [".git", ".terraform", "provisioning"]
}

# Upload the zipped app to S3:
resource "aws_s3_bucket_object" "uploaded_zip" {
  bucket = "nypl-travis-builds-${var.environment}"
  key    = "discovery-hybrid-indexer-${var.environment}-dist.zip"
  acl    = "private"
  source = data.archive_file.lambda_zip.output_path
  etag   = filemd5(data.archive_file.lambda_zip.output_path)
}

# Create the QA lambda:
resource "aws_lambda_function" "lambda_instance" {
  description   = "See https://github.com/NYPL/discovery-hybrid-indexer"
  function_name = "DiscoveryHybridIndexer-${var.environment}"
  handler       = "index.handler"
  memory_size   = 512
  role          = "arn:aws:iam::946183545209:role/lambda-full-access"
  runtime       = "nodejs14.x"
  timeout       = 300

  # Location of the zipped code in S3:
  s3_bucket     = aws_s3_bucket_object.uploaded_zip.bucket
  s3_key        = aws_s3_bucket_object.uploaded_zip.key

  # Trigger pulling code from S3 when the zip has changed:
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_config.subnet_ids
    security_group_ids = var.vpc_config.security_group_ids
  }

  environment {
    variables = var.env_vars
  }
}
