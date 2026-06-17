# GLEXIS Data Links

Static GitHub Pages site for browsing GLEXIS file links on IIASA S3.

This repository contains only the generated web viewer and link catalogs. It does not contain the raster data or the raw exported `delta-tree` HTML source files.

## Publish On GitHub Pages

Create this as a public GitHub repository, then enable:

```text
Settings -> Pages -> Deploy from a branch
Branch: main
Folder: /root
```

The site entry point is `index.html`.

## Note

Some future-scenario links contain signed S3 query strings from the source export. If those links expire, regenerate the catalogs in the private source repository and copy the updated site files here.

