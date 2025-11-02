import { parentPort, workerData } from 'worker_threads';
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';
import { ImageProcessor, SharpenMode } from './ImageProcessor';
import * as fs from 'fs';

(global as any).ImageData = ImageData;

interface WorkerData {
  framePath: string;
  blurRadius: number;
  sharpenStrength: number;
  sharpenMode: SharpenMode;
  numIterations: number;
  width: number;
  height: number;
}

/**
 * This is where we blur and sharpen the image
 *
 * @param data
 */
async function processFrame(data: WorkerData): Promise<void> {
  const { framePath, blurRadius, sharpenStrength, sharpenMode, numIterations, width, height } = data;

  const image = await loadImage(framePath);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(image, 0, 0);

  let imageData = ctx.getImageData(0, 0, width, height);

  for (let i = 0; i < numIterations; i++) {
    imageData = ImageProcessor.gaussianBlur(imageData, blurRadius);
    imageData = ImageProcessor.sharpenImage(imageData, sharpenStrength, sharpenMode);
  }

  ctx.putImageData(imageData, 0, 0);
  const buffer = await canvas.encode('png');
  fs.writeFileSync(framePath, buffer);
}

if (parentPort) {
  processFrame(workerData)
    .then(() => {
      parentPort!.postMessage({ success: true });
    })
    .catch((error) => {
      parentPort!.postMessage({ success: false, error: error.message });
    });
}
