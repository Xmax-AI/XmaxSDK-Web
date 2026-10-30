# Use XmaxSDK in an HTML page

The browser distribution uses native ES modules and includes the SDK's runtime dependencies. Your page
does not need npm, React, an import map, or an external module conversion service. RTC and storage
dependencies load when their corresponding capabilities are used.

## Build

From the repository root, with workspace dependencies installed:

```bash
npm run build:browser --workspace @xmaxai/web-sdk
```

The output is `packages/xmax-sdk/dist/browser/`:

```text
index.js
chunks/
LICENSE
```

Keep the entire directory together. The entry imports the dependency chunks by relative path.
`npm run build` still builds the existing npm entry points and cleans `dist/`; when building both
distributions, run the browser build last.

To rebuild and check module imports and public exports:

```bash
npm run test:browser --workspace @xmaxai/web-sdk
```

## Import from your page

Copy the distribution into your site's `sdk/` directory:

```html
<script type="module">
  import {
    XmaxClient,
    XmaxConfiguration,
    XmaxEnvironment,
  } from "./sdk/index.js";

  const client = new XmaxClient(new XmaxConfiguration({
    apiKey: "<YOUR_API_KEY>",
    environment: XmaxEnvironment.china,
  }));
</script>
```

The SDK APIs are the same as the npm package; see the [quick start](../README.md#quick-start).
For CDN hosting, upload the entire directory under a fixed version path and use the entry's HTTPS URL.
Serve JavaScript with a JavaScript MIME type and allow cross-origin module requests when your page and
CDN have different origins. The CDN changes SDK file delivery; API and RTC traffic still use the
configured service environment.
