# AWS Architecture Icons (vendored subset)

The SVG files in this directory are official **AWS Architecture Icons**, copied
unmodified from the icon package published by Amazon Web Services. They are not
covered by this repository's own license. AWS and the AWS service names and
icons are trademarks of Amazon.com, Inc. or its affiliates. This project is not
affiliated with or endorsed by AWS.

## Source

- Page: <https://aws.amazon.com/architecture/icons/> (retrieved 2026-10-01)
- Package: `Icon-package_07312026` (the "Icon package" download on that page,
  Q3 2026 release), SHA-256 of the zip:
  `d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526`
- Files: `Architecture-Service-Icons_07312026/Arch_*/48/Arch_*_48.svg`, only the
  services in this app's 41-service catalog (40 files; Amazon Bedrock and
  Amazon Bedrock Knowledge Bases share the Amazon Bedrock icon).

## Usage terms (as published on the page above, 2026-10-01)

> "To help you build diagrams, this page has Amazon Web Services (AWS) product
> icons, resources, and tools you can use. We allow customers and partners to
> use these toolkits and assets to create architecture diagrams."

> "AWS architecture icons are designed to be simple, so you can easily use them
> in diagrams. You can also put icons in materials like whitepapers,
> presentations, data sheets, and posters."

> "You can build diagrams with preexisting libraries on third-party tools."

The page states no attribution requirement. This app uses the icons only to
draw architecture diagrams of AWS services. The files are kept byte-identical to
the package; the build only strips the XML prolog, `<title>`, and `id`
attributes when embedding them, with no visual change.

The package contains no separate license file, and the page does not address
redistributing the icon files themselves (as this public repository does). Check
the page for current terms before reusing these files outside this app.

## Mapping notes

The catalog id to file mapping lives in `shared/awsIcons.ts`. Where the package
has no icon for a catalog entry, the closest parent-service icon is used:

| Catalog entry | Icon used |
| --- | --- |
| Amazon ECS on AWS Fargate | Amazon Elastic Container Service |
| Application Load Balancer | Elastic Load Balancing |
| AWS Amplify Hosting | AWS Amplify |
| Amazon Bedrock Knowledge Bases | Amazon Bedrock |
| Amazon OpenSearch Serverless | Amazon OpenSearch Service |
| Amazon Q Business | Amazon Q |
