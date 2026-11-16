# Public fare-observation worker — unpublished draft

This draft is not deployed. Do not enable it in a private repository.

It captures synthetic Tokyo-to-Asia fare observations with a fresh, headed browser. It does not enter passenger details, consent to a booking, reserve or pay. Human verification or an explicit access restriction stops the batch. It does not use proxies, stealth settings or saved browser sessions.

The public code contains no site ID, site URL, service credential, account login or private project strategy. `collector/probe.mjs` is the existing capture procedure, copied unchanged. Captured data is untrusted: the private receiving VM must validate price, payment conditions, all airports/times/flights, nights and freshness before saving an accepted quote or publishing.

## Public and private data

Public: source, workflow, recipient **public** certificate, synthetic search request (request ID, creation time, airports and dates), workflow status, encrypted receipt assets.

Private: recipient private key, decrypted originals, accepted quote database and publication credentials. The runner never receives Sites credentials. Originals are not printed to workflow logs or stored as Actions artifacts or caches. The runner encrypts a receipt with OpenSSL CMS/AES-256-GCM and RSA-OAEP; only the private VM's key can decrypt it. A pinned official GitHub attestation action binds the encrypted file digest to the workflow run. One ZIP asset contains ciphertext and the public attestation bundle; no plaintext original. Asset names include request ID, run ID and attempt; existing run assets are never overwritten.

## Initial test

After the owner approves publication, put a recipient public certificate at `recipient.pem`. Keep its private key on the receiving VM; never commit it. Create `requests/latest.json` with exactly these fields:

```json
{
  "requestId": "a new lowercase UUID",
  "createdAt": "current ISO timestamp with timezone",
  "tasks": [{"from":"NRT","to":"ICN","out":"YYYY-MM-DD","back":"YYYY-MM-DD"}]
}
```

Only fixed Tokyo origins and the configured five destination cities are accepted. Requests expire after 45 minutes; departure is 7–60 days ahead. A batch contains 1–5 unique cities. One task is for the initial capture test; it is never evidence of five-city completion. The receiving VM still enforces actual 2–14 local nights and the full original validator. A valid request identity that fails validation produces an encrypted rejection receipt. Malformed identities cannot be published as assets.

A main-branch request-file update starts the worker. Manual dispatch reads the same file. There is no schedule in this draft. Each route is bounded at 240 seconds, with 60 seconds between routes. The job is bounded at 30 minutes. The VM must not submit another request while its previous run is active. Captured originals are not publication success: the VM must verify the GitHub attestation against the expected repository/workflow/source commit, check run ID/attempt and exact request hash/identity, deduplicate request IDs across months, decrypt, apply the complete original validator, and run its existing publication/readback pipeline. Decryption alone is not proof of origin.

## Cost boundaries and remaining acceptance

Only the standard `ubuntu-24.04` public runner is configured. Larger runners, Actions artifacts, caches, Packages and LFS are not used. [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) describes public standard-runner compute as free; [runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) list 4 vCPUs/16GB RAM. [Release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) allow up to 1,000 assets per release, each below 2GiB. Hourly operation produces up to 744 assets in a 31-day month; manual tests add more, so the VM must monitor the limit and fail rather than discard or overwrite originals. [Attestations](https://github.com/actions/attest) support current GitHub plans in public repositories.

Unverified: live GitHub execution, source access restrictions on that runner, VM-to-GitHub dispatch authorization, decryption/import validation, five-city publication/readback and multiple normal cycles. This draft does not establish stable operation. Existing production collection must remain enabled until migration acceptance.
