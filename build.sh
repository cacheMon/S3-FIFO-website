#!/bin/bash 

python3 -m venv .venv
source .venv/bin/activate
pip3 install mkdocs-material=="9.2.0b0"
pip3 install mkdocs-minify-plugin
mkdocs serve
