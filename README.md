# Discovery Hybrid Indexer

This is an experimental app investigating combining the [DiscoveryStorePoster](https://github.com/NYPL-discovery/discovery-store-poster) and [DiscoveryApiIndexer](https://github.com/NYPL-discovery/discovery-api-indexer) deployments into a single app that accomplishes their work without the overhead of an intermediary database (the "legacy discovery-store database"). This implementation includes both components as modules, overwriting certain behaviors (notably db writes and reads). It may be connected to the same Lambda triggers currently used in the [DiscoveryStorePoster](https://github.com/NYPL-discovery/discovery-store-poster) and can be expected to produce the same output as the [DiscoveryApiIndexer](https://github.com/NYPL-discovery/discovery-api-indexer).

## Setup

```
nvm use; npm i
```

You can then process event files like so:

```
$ sam local invoke --profile nypl-digital-dev -t sam.qa.yml -e test/sample-events/b10128427.json
Invoking index.handler (nodejs10.x)
...
{"timestamp":"2021-07-15T14:12:35.095Z","levelCode":6,"level":"INFO","pid":"14","message":"Handling Bib event: sierra-nypl/10128427"}
{"timestamp":"2021-07-15T14:12:39.775Z","levelCode":6,"level":"INFO","pid":"14","message":"Completed processing 1 doc(s)"}
END RequestId: 79eeb9f0-2c7c-45ae-8322-ace4ee89bfed
REPORT RequestId: 79eeb9f0-2c7c-45ae-8322-ace4ee89bfed	Init Duration: 0.12 ms	Duration: 12696.30 ms	Billed Duration: 12700 ms	Memory Size: 128 MB	Max Memory Used: 128 MB
"Wrote 1 doc(s)"%
```

## Testing

To run several tests of this app's ability to handle various Kinesis events and write relevant ES documents:

```
nvm use
npm test
```

### Sample Events

`test/sample-events` contains a number of JSONs modeling Bib, Item, and Holding Kinesis stream events.

#### Comparing with remote indexed document

Compare ES document generated by this app with the document currently indexed remotely via:
```
node scripts/compare-with-indexed.js ./test/sample-events/b10128427.json [--envfile config/qa.env]
```

#### Creating sample events
To create a new sample event, use the `kinesify-data` script from `discovery-store-poster`, e.g.:

```
node ./node_modules/pcdm-store-updater/kinesify-data.js --profile nypl-digital-dev --envfile config/local-qa.env --ids 10128427 --nyplType bib '' test/sample-events/b10128427.json
```

Note you'll need to specify an `envfile` that contains these *decrypted* creds:
```
NYPL_API_BASE_URL=http://qa-platform.nypl.org/api/v0.1/
NYPL_OAUTH_URL=https://isso.nypl.org/
NYPL_OAUTH_KEY=[decrypted key]
NYPL_OAUTH_SECRET=[decrypted secret]
```

### Adding fixtures

As unit tests are added/modified, calls to platform endpoints from within the test suite may produce errors like `Missing fixture (./test/fixtures/platform-api-c3b6d56abdd478b5cf62207bf03ccef6.json) for  {"method":"GET","uri":"http://qa-platform.nypl.org/api/v0.1/bibs...}`. To fill in missing fixtures, run this:

```
source .env-for-fixture-building; UPDATE_FIXTURES=if-missing npm test
```

(`.env-for-fixture-building` can be built using `.env-for-fixture-building-sample` as a guide.)

## Contributing

This repo uses the [Development-QA-Main Git Workflow](https://github.com/NYPL/engineering-general/blob/master/standards/git-workflow.md#development-qa-main)

### Deployment

This app uses Travis-CI and terraform for deployment. Code pushed to `qa` and `main` trigger deployments to `qa` and `production`, respectively.

#### Troubleshooting deployments

**Importing existing resources**:

Because terraform state is synced to S3, you should never have to do this, but should you need to make `terraform` aware of a lambda resource that was created outside of `terraform`, you can import the existing resource like this:

```
terraform -chdir=provisioning/production import module.base.aws_lambda_function.lambda_instance DiscoveryHybridIndexer-production
```

**Terraform deprecation warnings**:

As Terraform names evolve, you may encounter warnings like this:

```
│ Warning: Argument is deprecated
│   with module.base.aws_s3_bucket_object.uploaded_zip,
│   on ../base/resources.tf line 31, in resource "aws_s3_bucket_object" "uploaded_zip":
│   31:   bucket = "nypl-travis-builds-${var.environment}"
│
│ Use the aws_s3_object resource instead
```

In this case, the resource type FKA `aws_s3_bucket_object` is changing to `aws_s3_object`. To migrate to the new name:
 1. Change `.tf` files to use `aws_s3_object`
 2. Import the existing S3 objects into the new name:
   - `terraform -chdir=provisioning/qa import module.base.aws_s3_object.uploaded_zip nypl-travis-builds-qa/discovery-hybrid-indexer-qa-dist.zip`
   - `terraform -chdir=provisioning/production import module.base.aws_s3_object.uploaded_zip nypl-travis-builds-production/discovery-hybrid-indexer-production-dist.zip`
 3. Run a `plan` to confirm terraform reports minimal changes to the new S3 resource (Note: terraform may report it will fully delete the previous S3 resource and that is okay.)

**Terraform reports resource type not supported**:

When encountering errors like this:
```
The provider hashicorp/aws does not support resource type "aws_s3_object"
```

If you believe the resource type _should_ be supported, the provider version may be behind. To see the provider version, run an `init` and look for a line like "Using previously-installed hashicorp/aws v4.13.0". Note: Provider versions are cached _by deployment_, so an error of this sort may arise for one deployment but not the other. Set provider versions explicitly in the base terraform file to mitigate.
