# Corpus sources

`ai-sdk-core/` holds the AI SDK Core documentation, the corpus this app answers from. The files are the upstream files, unmodified.

| | |
|---|---|
| Source | https://github.com/vercel/ai/tree/3f3a717e2237c56aed9fab22269f07ccfeb0a142/content/docs/03-ai-sdk-core |
| Tag | `ai@7.0.114`, the AI SDK version this app runs |
| Commit | `3f3a717e2237c56aed9fab22269f07ccfeb0a142`, which the tag resolves to |
| Fetched | 2026-09-29 |
| Files | 32 `.mdx` files, 450,783 bytes |
| Corpus hash | `8d11fa945d90d43b755bd61f11f238a17e141b285040c7f8a53e3bb6dbcdf5ee`, the SHA-256 of `SHA256SUMS` |

`pnpm fetch-corpus` (`scripts/fetch-corpus.ts`) checked that the tag resolves to the commit, fetched each file through the GitHub contents API at the commit, checked its bytes against its git blob SHA, checked the Apache License text against its pinned SHA-256, wrote `SHA256SUMS`, and printed the figures above and the license hashes below. `tests/corpus.test.ts` checks them against the committed files. To check by hand, from the repo root:

```sh
(cd corpus/ai-sdk-core && shasum -a 256 -c ../SHA256SUMS)
shasum -a 256 corpus/SHA256SUMS # prints the corpus hash
shasum -a 256 corpus/LICENSE corpus/LICENSE-2.0.txt # prints the license hashes below
```

## License

- The upstream repository's `LICENSE` at the tag is the Apache License 2.0 notice, "Copyright 2023 Vercel, Inc.". [`LICENSE`](LICENSE) here is that file, verbatim. Its SHA-256 is `b4f9adb7c568904834d0dd6cc98d16c390d21ca32fc17ae7a267715269bd5529`.
- The upstream repository has no `NOTICE` file at the tag: the contents API answers 404.
- GitHub's license detector reports `NOASSERTION` for that short notice (`gh api repos/vercel/ai/license`).
- [`LICENSE-2.0.txt`](LICENSE-2.0.txt) is the full text of the Apache License 2.0, verbatim from https://www.apache.org/licenses/LICENSE-2.0.txt, because section 4(a) of the License requires giving recipients a copy of the License itself, not only the notice. Its SHA-256 is `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, pinned in `lib/rag/config.ts`: the fetch refuses any other bytes.

## What is under Apache-2.0

The contents of `corpus/`, including the chunk text inside `corpus/index.json`, are licensed under the Apache License 2.0, not under this repository's MIT license. `index.json` is derived from the unmodified files: each chunk's text is a range of lines of one file, copied unchanged.
