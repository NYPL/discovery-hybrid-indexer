terraform {
  backend "s3" {
    bucket  = "nypl-travis-builds-qa"
    key     = "discovery-hybrid-indexer-terraform-state"
    region  = "us-east-1"
  }
}

provider "aws" {
  region     = "us-east-1"
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/dist.zip"
  source_dir  = "."
  excludes    = ["dist.zip", ".git", ".terraform"]
}

resource "aws_s3_bucket_object" "uploaded_zip" {
  bucket = "nypl-travis-builds-qa"
  key    = "discovery-hybrid-indexer-qa-dist.zip"
  acl    = "private"
  source = data.archive_file.lambda_zip.output_path
  etag = filemd5(data.archive_file.lambda_zip.output_path)
}

resource "aws_lambda_function" "qa_instance" {
  description   = "See https://github.com/NYPL/discovery-hybrid-indexer"
  function_name = "DiscoveryHybridIndexer-qa"
  handler       = "index.handler"
  memory_size   = 512
  role          = "arn:aws:iam::946183545209:role/lambda-full-access"
  runtime       = "nodejs14.x"
  timeout       = 300

  s3_bucket     = aws_s3_bucket_object.uploaded_zip.bucket
  s3_key        = aws_s3_bucket_object.uploaded_zip.key

  vpc_config {
    subnet_ids         = ["subnet-21a3b244", "subnet-f35de0a9"]
    security_group_ids = ["sg-aa74f1db"]
  }

  environment {
    variables = {
      ELASTICSEARCH_CONNECTION_URI = "AQECAHh7ea2tyZ6phZgT4B9BDKwguhlFtRC6hgt+7HbmeFsrsgAAAK8wgawGCSqGSIb3DQEHBqCBnjCBmwIBADCBlQYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAxrJio3oL3JETS6dNMCARCAaKtg+mvgbSkkLh6JiZ97c02ZH3gWpOBGD8vNadjl7p/SjS7aTtBjanWOfsXdwkEYq6s1SHwGtfwmSB4X6ExBYXDUDFWlmJ/FODtEvMoNXkD0ERXHGvxmSnWWbvh4sa+/QUOvMf9k5y5t"
      ELASTIC_RESOURCES_INDEX_NAME = "resources-2020-05-08"
      OUTGOING_STREAM_NAME = "IndexDocumentProcessed-qa"
      AEON_REQUESTABLE_LOCATIONS = "scdd1,scdd2,marr2,mar62,mar82,mard2"
      AEON_REQUESTABLE_SHELFMARK_REGEX = ".*"
      AEON_BASE_URLS = "https://specialcollections.nypl.org,https://nypl-aeon-test.aeon.atlas-sys.com"
      DISCOVERY_STORE_CONNECTION_URI = "AQECAHh7ea2tyZ6phZgT4B9BDKwguhlFtRC6hgt+7HbmeFsrsgAAAGEwXwYJKoZIhvcNAQcGoFIwUAIBADBLBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDDXaZHpMncYfoQlb9wIBEIAePWUS8cXaMO5ZqUQudl2b6cA9xt9jp4Rsllj4nXj7"
      NYPL_API_BASE_URL = "http://qa-platform.nypl.org/api/v0.1/"
      NYPL_CORE_VERSION = "v1.37"
      NYPL_OAUTH_URL = "https://isso.nypl.org/"
      NYPL_OAUTH_KEY = "AQECAHh7ea2tyZ6phZgT4B9BDKwguhlFtRC6hgt+7HbmeFsrsgAAAGswaQYJKoZIhvcNAQcGoFwwWgIBADBVBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDNQozUGkaz8WYD2lUAIBEIAo/SzNMA9LowO6gcnTUCcMjBaAU1RH/L3EAS14fjJCUpyZppkuEDUd7w=="
      NYPL_OAUTH_SECRET = "AQECAHh7ea2tyZ6phZgT4B9BDKwguhlFtRC6hgt+7HbmeFsrsgAAAIcwgYQGCSqGSIb3DQEHBqB3MHUCAQAwcAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAxN3indXvk2ueiE6CwCARCAQ018FdIVXXwfTuKH1vp/ZTfjBinxKTDosMmzyWB9/CtiFtgOu09iiyZEpC3AyGOt8ExywHZoHOZQuLdGGNFgbusmldw="
      LOGLEVEL = "info"
    }
  }
}