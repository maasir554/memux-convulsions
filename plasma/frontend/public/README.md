# public/

Files in this folder are served by Vite as static assets at the site root.

For example `public/lemonade.svg` is reachable at `/lemonade.svg` from anywhere
in the app — `<img src="/lemonade.svg" />`. No import / bundling step needed,
so it's the right place for logos, favicons, OG images, and downloads.

To swap the placeholder Lemonade mark for the official one, just overwrite
`lemonade.svg` (or drop in `lemonade.png` and update the component to point
at the new filename).
