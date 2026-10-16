# S3-FIFO-website
mkdoc source code for S3-FIFO webpage

## Local build
1. Set up a virtual environment
```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Open up a terminal and install Material for MkDocs with (starting from 9.2.0b0, Material supports blog feature):
```bash
pip3 install mkdocs-material=="9.2.0b0"
```

3. Install minify plugin
```bash
pip3 install mkdocs-minify-plugin
```

4. Previewing the website
```bash
mkdocs serve
```

## How the landing page is built
- `material/home.html` is the landing page template. It extends `main.html`, which adds the fonts,
  the link-preview tags and analytics to every page.
- `material/home.css` styles the landing page. The colors are `--s3-*` tokens defined for light and
  dark in `docs/stylesheets/extra.css`, which also styles the header, the footer and the blog.
- `material/partials/header.html` is Material's header with two changes: it shows the short name
  (`extra.short_name` in `mkdocs.yml`), and on wide screens the Home and Blog tabs sit in the same row.
- `material/sim.js` runs the S3-FIFO simulation in "How it works". It follows libCacheSim's
  `S3FIFO.c`: two hits in S promote an object to M, M reinserts objects whose counter is above zero,
  and G holds as many keys as M. Run `node -e "require('./material/sim.js')"` to load its cache
  model without a browser.
- `material/mychart.js` draws the four charts with Chart.js and builds their data tables. The series
  colors were checked for color-vision deficiency in both schemes; keep LRU blue and S3-FIFO orange.

## Editing the adoption list
Adopters are data at the top of `material/home.html`, one row per entry:

```jinja
("ClickHouse", "https://github.com/ClickHouse/ClickHouse/pull/123435", "ClickHouse"),
```

The fields are the name, the link, and the GitHub owner whose avatar to show. Section headings count
the rows, so adding a row is all it takes.

- Link to the code, merged PR or docs that show S3-FIFO in use, not just the project homepage.
- Add a new owner to `avatar_ids` with its numeric GitHub id. The name-based avatar URL returns a
  blank default for many organizations; `curl -sI https://github.com/<owner>.png` shows the id in
  the redirect (`/u/<id>`).
- Adopters with no public source go in `private`; they show as dashed tiles without a link.
- Open pull requests go under `in_progress` until they merge.
- Keep the list in sync with the [cacheMon homepage](https://cachemon.org/#production).
