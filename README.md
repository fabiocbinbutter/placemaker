# Placemaker

Tool to generate static HTML pages with local place information from Foursqaure

To use:

    node index.js

Then navigate to http://localhost:8009 and provide form inputs.

Build process initialization will be logged to the console.

Build process completion will be notified in the browser, and
 in the console with detailed timing stats in the console.

Once complete, the built HTML and image assets will be located
 in the `places/<slug>` directory, where `<slug>` is the slug 
 you provided in the form.

To correctly display the place page(s), upload the `places` and
 `resources` directories to your webserver root.
