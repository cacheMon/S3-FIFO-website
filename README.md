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

## Editing the adoption list
The landing page lives in `material/home.html`. Each adopter is one line using the
`chip(name, link, avatar, tag)` macro defined just above the Adoption section:

```jinja
{{ chip("ClickHouse", "https://github.com/ClickHouse/ClickHouse/pull/123435", "https://avatars.githubusercontent.com/ClickHouse?s=64") }}
```

- Link to the code, merged PR or docs that show S3-FIFO in use, not just the project homepage.
- Use `https://avatars.githubusercontent.com/<org>?s=64` for the avatar; it needs no redirect.
- Open pull requests go under "In progress upstream" until they merge.
- Keep the list in sync with the [cacheMon homepage](https://cachemon.org/#production).
