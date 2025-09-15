// script.js (module)
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const downloadMosaicBtn = document.getElementById('downloadMosaicBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const cubesAcrossInput = document.getElementById('cubesAcross');
const stickerPxInput = document.getElementById('stickerPx');
const blurSigmaInput = document.getElementById('blurSigma');
const lumWeightInput = document.getElementById('lumWeight');
const saveCubesCheckbox = document.getElementById('saveCubes');
const mosaicCanvas = document.getElementById('mosaicCanvas');
const previewThumbnail = document.getElementById('previewThumbnail');
const infoEl = document.getElementById('info');

let loadedImage = null;
let lastResult = null;

// Palette in RGB (W Y R O B G)
const PALETTE_KEYS = ['W','Y','R','O','B','G'];
const PALETTE_RGB = [
  [255,255,255],
  [255,213,0],
  [170,16,31],
  [255,88,0],
  [0,70,173],
  [0,155,72],
];

// Helper: read file into Image object
function readFileToImage(file){
  return new Promise((res, rej)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = e => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

// Drag & drop UX
['dragenter','dragover'].forEach(ev=>{
  dropArea.addEventListener(ev,e=>{ e.preventDefault(); dropArea.classList.add('drag'); });
});
['dragleave','drop'].forEach(ev=>{
  dropArea.addEventListener(ev,e=>{ e.preventDefault(); dropArea.classList.remove('drag'); });
});
dropArea.addEventListener('drop', async e=>{
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) await loadImageFile(f);
});
fileInput.addEventListener('change', async e=>{
  const f = e.target.files && e.target.files[0];
  if(f) await loadImageFile(f);
});

async function loadImageFile(file){
  try{
    loadedImage = await readFileToImage(file);
    // show a small thumbnail
    const ctx = previewThumbnail.getContext('2d');
    const W = 240;
    const h = Math.round(W * loadedImage.height / loadedImage.width);
    previewThumbnail.width = W; previewThumbnail.height = h;
    ctx.clearRect(0,0,W,h);
    ctx.drawImage(loadedImage,0,0,W,h);
    previewThumbnail.hidden = false;
    processBtn.disabled = false;
    infoEl.textContent = `Loaded ${file.name} — ${loadedImage.width}×${loadedImage.height}px`;
  }catch(err){
    alert('Could not load image: '+err);
  }
}

// Utility: convert RGB to LAB (approximated) and back helpers
// We'll implement an sRGB -> XYZ -> LAB conversion.
// Reference D65; functions operate on [0..255] arrays.
function srgbToXyz([r,g,b]){
  // linearize sRGB
  const R = r/255, G = g/255, B = b/255;
  const linear = x => x <= 0.04045 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4);
  const rL = linear(R), gL = linear(G), bL = linear(B);
  // sRGB to XYZ (D65)
  const X = rL*0.4124564 + gL*0.3575761 + bL*0.1804375;
  const Y = rL*0.2126729 + gL*0.7151522 + bL*0.0721750;
  const Z = rL*0.0193339 + gL*0.1191920 + bL*0.9503041;
  return [X,Y,Z];
}
function xyzToLab([X,Y,Z]){
  // D65 white point
  const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16/116);
  const fx = f(X/Xn), fy = f(Y/Yn), fz = f(Z/Zn);
  const L = (116 * fy) - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return [L,a,b];
}
function rgbToLab(rgb){
  return xyzToLab(srgbToXyz(rgb));
}

// Quantization: serpentine Floyd-Steinberg with luminance weighting using LAB
function quantizeWithDithering(imgData, W, H, paletteRgb, lumWeight=2.2) {
  // imgData: Uint8ClampedArray RGBA per pixel from canvas getImageData
  // We'll work in float RGB array working[y][x]=[r,g,b]
  const working = new Array(H);
  let ptr=0;
  for(let y=0;y<H;y++){
    working[y] = new Array(W);
    for(let x=0;x<W;x++){
      const r = imgData[ptr++], g = imgData[ptr++], b = imgData[ptr++], a = imgData[ptr++];
      working[y][x] = [r,g,b];
    }
  }

  // precompute palette LAB and palette RGB float
  const palRgb = paletteRgb.map(p => p.slice());
  const palLab = paletteRgb.map(p => rgbToLab(p));

  const idxMap = new Array(H);
  for(let y=0;y<H;y++){
    idxMap[y] = new Int8Array(W);
  }

  for(let y=0;y<H;y++){
    const leftToRight = (y % 2 === 0);
    const xs = leftToRight ? [...Array(W).keys()] : [...Array(W).keys()].reverse();
    for(const x of xs){
      const pixel = working[y][x];
      // clamp
      const pr = Math.max(0, Math.min(255, pixel[0]));
      const pg = Math.max(0, Math.min(255, pixel[1]));
      const pb = Math.max(0, Math.min(255, pixel[2]));

      const labPx = rgbToLab([pr,pg,pb]);
      // luminance-weighted distance
      let bestIdx = 0, bestD = Infinity;
      for(let i=0;i<palLab.length;i++){
        const dL = (palLab[i][0] - labPx[0]) * lumWeight;
        const da = palLab[i][1] - labPx[1];
        const db = palLab[i][2] - labPx[2];
        const d2 = dL*dL + da*da + db*db;
        if(d2 < bestD){ bestD=d2; bestIdx=i; }
      }
      idxMap[y][x] = bestIdx;
      const chosenRgb = palRgb[bestIdx];

      // compute error
      const err = [
        pixel[0] - chosenRgb[0],
        pixel[1] - chosenRgb[1],
        pixel[2] - chosenRgb[2]
      ];

      // distribute error (serpentine)
      if(leftToRight){
        if(x+1 < W) { addError(working, y, x+1, err, 7/16); }
        if(y+1 < H){
          if(x-1 >=0) addError(working, y+1, x-1, err, 3/16);
          addError(working, y+1, x, err, 5/16);
          if(x+1 < W) addError(working, y+1, x+1, err, 1/16);
        }
      } else {
        if(x-1 >= 0) addError(working, y, x-1, err, 7/16);
        if(y+1 < H){
          if(x+1 < W) addError(working, y+1, x+1, err, 3/16);
          addError(working, y+1, x, err, 5/16);
          if(x-1 >=0) addError(working, y+1, x-1, err, 1/16);
        }
      }
    }
  }

  return idxMap;
}

function addError(working, y, x, err, factor){
  working[y][x][0] += err[0] * factor;
  working[y][x][1] += err[1] * factor;
  working[y][x][2] += err[2] * factor;
}

// Utility: simple gaussian blur via canvas (cheap)
function blurredImageData(img, targetW, targetH, blurRadius){
  // draw to offscreen canvas, scale, then apply filter via context.filter
  const off = document.createElement('canvas');
  off.width = targetW; off.height = targetH;
  const ctx = off.getContext('2d');
  if(blurRadius>0){
    ctx.filter = `blur(${blurRadius}px)`;
  } else {
    ctx.filter = 'none';
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return ctx.getImageData(0,0,targetW,targetH);
}

// Main process: build mosaic at sticker resolution
async function processImage(){
  if(!loadedImage) return;
  processBtn.disabled = true;
  downloadMosaicBtn.disabled = downloadCsvBtn.disabled = downloadZipBtn.disabled = true;

  const cubesAcross = Math.max(1, parseInt(cubesAcrossInput.value));
  const stickerPx = Math.max(4, parseInt(stickerPxInput.value));
  let blurSigma = parseFloat(blurSigmaInput.value) || 0;
  const lumWeight = parseFloat(lumWeightInput.value) || 2.2;
  const saveCubes = saveCubesCheckbox.checked;

  const stickersAcross = cubesAcross * 3;
  const aspect = loadedImage.height / loadedImage.width;
  let stickersHigh = Math.round(stickersAcross * aspect);
  if(stickersHigh % 3 !== 0) stickersHigh += (3 - (stickersHigh % 3));
  const cubesDown = Math.floor(stickersHigh / 3);

  infoEl.textContent = `Target stickers: ${stickersAcross}×${stickersHigh}  → cubes: ${cubesAcross}×${cubesDown}`;

  // get blurred/resized image data
  const imgData = blurredImageData(loadedImage, stickersAcross, stickersHigh, blurSigma);

  // quantize with dithering
  const idxMap = quantizeWithDithering(imgData.data, stickersAcross, stickersHigh, PALETTE_RGB, lumWeight);

  // render mosaic to canvas (stickerPx per sticker)
  mosaicCanvas.width = stickersAcross * stickerPx;
  mosaicCanvas.height = stickersHigh * stickerPx;
  const mctx = mosaicCanvas.getContext('2d');
  // draw rectangles manually (fast enough)
  const imgOut = mctx.createImageData(mosaicCanvas.width, mosaicCanvas.height);
  for(let sy=0; sy<stickersHigh; sy++){
    for(let sx=0; sx<stickersAcross; sx++){
      const palIdx = idxMap[sy][sx];
      const color = PALETTE_RGB[palIdx];
      // fill the stickerPx block in imgOut
      for(let dy=0; dy<stickerPx; dy++){
        const py = sy*stickerPx + dy;
        for(let dx=0; dx<stickerPx; dx++){
          const px = sx*stickerPx + dx;
          const pos = (py * mosaicCanvas.width + px) * 4;
          imgOut.data[pos] = color[0];
          imgOut.data[pos+1] = color[1];
          imgOut.data[pos+2] = color[2];
          imgOut.data[pos+3] = 255;
        }
      }
    }
  }
  mctx.putImageData(imgOut,0,0);

  // prepare CSV
  const csvRows = [];
  csvRows.push(['cube_x','cube_y','row0','row1','row2']);
  for(let cy=0; cy<cubesDown; cy++){
    for(let cx=0; cx<cubesAcross; cx++){
      const sy = cy*3, sx = cx*3;
      const rows = [];
      for(let r=0;r<3;r++){
        let s='';
        for(let c=0;c<3;c++){
          s += PALETTE_KEYS[ idxMap[sy+r][sx+c] ];
        }
        rows.push(s);
      }
      csvRows.push([cx, cy, rows[0], rows[1], rows[2]]);
    }
  }

  lastResult = { idxMap, stickersAcross, stickersHigh, cubesAcross, cubesDown, stickerPx, csvRows };

  // enable downloads
  downloadMosaicBtn.disabled = downloadCsvBtn.disabled = false;
  downloadZipBtn.disabled = !saveCubes;
  processBtn.disabled = false;
  infoEl.textContent = `Done. Mosaic size: ${mosaicCanvas.width}×${mosaicCanvas.height}px. Cubes: ${cubesAcross}×${cubesDown}.`;
}

// Download handlers
downloadMosaicBtn.addEventListener('click', ()=>{
  if(!lastResult) return;
  mosaicCanvas.toBlob(blob => {
    saveAs(blob, 'mosaic.png');
  }, 'image/png');
});

downloadCsvBtn.addEventListener('click', ()=>{
  if(!lastResult) return;
  const csv = lastResult.csvRows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, 'cubes_map.csv');
});

downloadZipBtn.addEventListener('click', async ()=>{
  if(!lastResult) return;
  const zip = new JSZip();
  const { idxMap, cubesAcross, cubesDown, stickerPx } = lastResult;

  // generate each cube image in an in-memory canvas
  for(let cy=0; cy<cubesDown; cy++){
    for(let cx=0; cx<cubesAcross; cx++){
      const cvc = document.createElement('canvas');
      cvc.width = 3*stickerPx; cvc.height = 3*stickerPx;
      const cctx = cvc.getContext('2d');
      // build image data
      const cd = cctx.createImageData(cvc.width, cvc.height);
      for(let r=0;r<3;r++){
        for(let c=0;c<3;c++){
          const pal = PALETTE_RGB[ idxMap[cy*3+r][cx*3+c] ];
          for(let dy=0;dy<stickerPx;dy++){
            for(let dx=0;dx<stickerPx;dx++){
              const x = c*stickerPx + dx;
              const y = r*stickerPx + dy;
              const pos = (y * cvc.width + x) * 4;
              cd.data[pos] = pal[0];
              cd.data[pos+1] = pal[1];
              cd.data[pos+2] = pal[2];
              cd.data[pos+3] = 255;
            }
          }
        }
      }
      cctx.putImageData(cd,0,0);
      const dataUrl = cvc.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      zip.file(`cube_${cx.toString().padStart(3,'0')}_${cy.toString().padStart(3,'0')}.png`, base64, {base64:true});
    }
  }

  infoEl.textContent = 'Building ZIP (may take a few seconds)...';
  const content = await zip.generateAsync({type:'blob'});
  saveAs(content, 'cube_images.zip');
  infoEl.textContent = `ZIP ready: ${cubesAcross}×${cubesDown} cubes`;
});

// wire process button
processBtn.addEventListener('click', processImage);
