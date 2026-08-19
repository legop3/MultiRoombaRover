import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  // Shared cards use their allocated width rather than the browser viewport to
  // decide when compact layouts are necessary. Tailwind 3 does not emit the
  // @container utility or @... variants unless its official plugin is enabled;
  // without this, every card silently remains in its unprefixed narrow layout.
  plugins: [containerQueries],
}
