
# Solar Panel Viewer

This web app lets you view, interact with, and analyze 3D solar panel layouts converted from CAD files. It supports model rotation, coordinate editing, shadow analysis, and more.

---

## Features

- 3D model viewer for GLB files
- Interactive rotation, pan, and zoom
- Add, move, or delete solar panels
- Edit object coordinates via UI
- Shadow coverage analysis for selected panels
- Sun position controls for lighting simulation
- Export the modified model as a new GLB file

---

## Workflow Overview

1. **Convert DWG to DXF**  
   Use [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter) or any other tool to convert your `.dwg` file to `.dxf` format.

2. **Convert DXF to GLB**  
   Open `ConvertToGLB.ipynb` and update the DXF filename as needed. Run the notebook/script to generate `output.glb`.

3. **Start a Local Server**  
   Open a command prompt/terminal, navigate to the Solar Panel Viewer folder:
   ```
   cd path/to/Solar Panel Viewer
   ```
   Then start a local server (Python 3):
   ```
   py -m http.server
   ```
   or
   ```
   python3 -m http.server
   ```

4. **Open the Viewer**  
   In your web browser, go to [http://localhost:8000/](http://localhost:8000/)

**Note:** Make sure your GLB file is named `output.glb` and is in the Solar Panel Viewer folder.

---

## File Descriptions

- `index.html` – Main HTML file and UI
- `style.css` – App styling and layout
- `script.js` – Main application logic
- `ConvertToGLB.ipynb` – Notebook for converting DXF to GLB

---

## Requirements

- Modern web browser (Chrome, Edge, Firefox, etc.)
- Python 3.x (for running the local server and DXF-to-GLB conversion)
- ODA File Converter or similar tool for DWG to DXF

---

## Accessibility & Notes

- The UI is accessible and responsive.
- All model processing is done locally in your browser.
- For large models, initial loading may take a few seconds.

---
