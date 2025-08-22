/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: "#1E3A8A",
        secondary: "#3B82F6",
      },
    },
  },
  plugins: [],
}
