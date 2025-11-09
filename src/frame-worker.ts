import { parentPort, workerData } from 'worker_threads';
import { createCanvas, loadImage, ImageData as CanvasImageData } from '@napi-rs/canvas';
import { ImageProcessor } from './ImageProcessor';
import * as fs from 'fs';

(global as any).ImageData = CanvasImageData;

interface WorkerData {
  framePath: string;
  blurRadius: number;
  sharpenStrength: number;
  sharpenMode: 'rgb' | 'lab';
  numIterations: number;
  width: number;
  height: number;
}

async function processFrame(): Promise<void> {
  try {
    const data: WorkerData = workerData;
    const image = await loadImage(data.framePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < data.numIterations; i++) {
      imageData = ImageProcessor.gaussianBlur(imageData, data.blurRadius);
      imageData = ImageProcessor.sharpenImage(
        imageData,
        data.sharpenStrength,
        data.sharpenMode
      );
    }

    ctx.putImageData(imageData, 0, 0);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(data.framePath, buffer);

    parentPort?.postMessage({ success: true });
  } catch (error) {
    parentPort?.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

processFrame();
