# Security policy

## Never commit

- private holdout cases or expected outcomes;
- wallet seed phrases, private keys, coordinator keys or API secrets;
- live attack credentials or production mutation scripts;
- unredacted child-process environments.

The default ignore rules cover common holdout and key paths, but reviewers must still inspect every diff.

## Adapter review

v0.0.1 accepts only argv arrays and never invokes a shell. New executables, network-enabled cases, writable production targets, dynamic module loading, or secret-bearing environments require a new engine version and explicit security review.

## Reporting a finding

Store the minimum reproducible evidence. Use hashes for large or sensitive outputs. An active blind case may be referenced only by its public case ID and commitment until retirement.
