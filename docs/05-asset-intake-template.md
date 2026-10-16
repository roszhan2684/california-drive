# Asset / license intake template

Copy this block into `ASSET_LICENSES.md` for every candidate asset **before** it is committed. Reject the asset if any field is unknown.

```markdown
### <asset name>
- Status: proposed | approved | rejected (reason)
- Type: model | texture | HDRI | sound | font | dataset | animation | code
- Source URL:
- Creator:
- Exact license (SPDX id + link):
- Evidence of license (quote / screenshot path / archived URL + date checked):
- Attribution required: yes/no — attribution text:
- Redistribution allowed: yes/no
- Modification allowed: yes/no
- Trademark / brand risk: none | low | high (explain; logos, model names, trade dress)
- Polygon count / texture size / duration:
- LOD availability:
- Optimization plan (KTX2, meshopt, resample, trim):
- Local path(s):
- Modifications made:
- Reviewer + date:
```

## Hard rejects
* "Free download" without an explicit license.
* Anything ripped from commercial games, Google Maps / Street View, films, or manufacturer websites.
* Licenses forbidding redistribution in a web build (e.g. "editorial use only", standard Sketchfab "free" without CC terms).
* Vehicles carrying real brand logos, badges or protected model names.
* CC-BY-NC / CC-BY-ND for anything we modify or ship in a project that might be monetized later.
