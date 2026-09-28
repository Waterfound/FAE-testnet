# Blind holdout

Only public commitments belong here. Keep case bodies, expected answers, reveal records and keys in holdout/private or outside the repository.

A commitment is SHA-256 over the canonical private case, including a secret commitment_nonce of at least 128 bits. The nonce prevents simple dictionary guessing of small answer spaces. The blind request exposes only case_id, domain, commitment and input_public. The engine records a submission without seeing expected_private or the nonce. A separate reveal verifies the commitment before scoring.

Never promote an active blind case. Retire it explicitly first, then require normal reproducibility and reviewer approval.
