# Application licensing status

No root application license grant has been selected by the repository owner. `package.json` explicitly records `UNLICENSED` and `private: true`; publishing the demo or its source does not grant an application license. This preserves the current licensing status. An open-source or commercial application license remains an owner decision.

Bundled dependencies retain their own licenses. The qpdf wrapper and engine use Apache 2.0 terms in `src/vendor/qpdf/LICENSE.txt`; the DejaVu subset retains `public/fonts/DejaVu-LICENSE.txt`. Their terms are not replaced by this application status. Locked npm package licenses and source/integrity records are exported by `npm run verify:provenance`; records with absent declarations are explicitly marked rather than inferred.
