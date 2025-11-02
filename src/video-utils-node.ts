import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Worker } from 'worker_threads';
import ffmpeg from 'fluent-ffmpeg';
import { SharpenMode } from './ImageProcessor';

interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

async function getVideoInfo(inputPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }

      const fps = videoStream.r_frame_rate
        ? eval(videoStream.r_frame_rate)
        : 30;

      resolve({
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps: fps,
        duration: metadata.format.duration || 0
      });
    });
  });
}

async function extractFrames(
  inputPath: string,
  tempDir: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    let frameCount = 0;

    ffmpeg(inputPath)
      .outputOptions([
        '-vf', 'fps=fps=30',
      ])
      .output(path.join(tempDir, 'frame-%06d.png'))
      .on('progress', (progress) => {
        if (progress.frames) {
          frameCount = progress.frames;
        }
      })
      .on('end', () => {
        console.log(`Extracted ${frameCount} frames`);
        resolve(frameCount);
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

async function processFrames(
  tempDir: string,
  frameCount: number,
  videoInfo: VideoInfo,
  blurRadius: number,
  sharpenStrength: number,
  sharpenMode: SharpenMode,
  numIterations: number
): Promise<void> {
  const maxWorkers = os.cpus().length;
  const workerScript = path.join(__dirname, 'frame-worker.js');

  console.log(`Processing frames with ${maxWorkers} parallel workers...`);

  let processedCount = 0;
  let activeWorkers = 0;
  const frameQueue: number[] = [];

  for (let i = 1; i <= frameCount; i++) {
    const framePath = path.join(tempDir, `frame-${String(i).padStart(6, '0')}.png`);
    if (fs.existsSync(framePath)) {
      frameQueue.push(i);
    }
  }

  return new Promise((resolve, reject) => {
    const processNextFrame = () => {
      if (frameQueue.length === 0) {
        if (activeWorkers === 0) {
          resolve();
        }
        return;
      }

      const frameNum = frameQueue.shift()!;
      const framePath = path.join(tempDir, `frame-${String(frameNum).padStart(6, '0')}.png`);

      activeWorkers++;

      const worker = new Worker(workerScript, {
        workerData: {
          framePath,
          blurRadius,
          sharpenStrength,
          sharpenMode,
          numIterations,
          // To create the effect where a video gradually transitions into a Turing Pattern, use the below line
          //numIterations: Math.max(0, frameNum - 30 * 7),
          width: videoInfo.width,
          height: videoInfo.height
        }
      });

      worker.on('message', (message) => {
        activeWorkers--;
        processedCount++;

        if (message.success) {
          console.log(`- Processed frame ${processedCount}/${frameCount}`);
        } else {
          console.error(`Error processing frame ${frameNum}:`, message.error);
        }

        worker.terminate();
        processNextFrame();
      });

      worker.on('error', (error) => {
        activeWorkers--;
        console.error(`Worker error on frame ${frameNum}:`, error);
        worker.terminate();
        processNextFrame();
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`);
        }
      });
    };

    for (let i = 0; i < maxWorkers && i < frameQueue.length; i++) {
      processNextFrame();
    }
  });
}

async function reassembleVideo(
  tempDir: string,
  outputPath: string,
  inputPath: string,
  videoInfo: VideoInfo
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    // Add processed frames as input
    command.input(path.join(tempDir, 'frame-%06d.png'))
      .inputFPS(videoInfo.fps);

    // Add original video as input for audio
    command.input(inputPath);

    // Map video from first input and audio from second input
    command.outputOptions([
      '-map', '0:v:0',  // Video from first input (processed frames)
      '-map', '1:a:0?', // Audio from second input (original video), ? makes it optional
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'copy',   // Copy audio without re-encoding
      '-pix_fmt', 'yuv420p'
    ]);

    command.output(outputPath)
      .on('progress', (progress) => {
        console.log(`Encoding: ${progress.percent?.toFixed(1)}% done`);
      })
      .on('end', () => {
        console.log('Video reassembly complete');
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

export async function processVideoWithFilter(
  inputPath: string,
  outputPath: string,
  blurRadius: number,
  sharpenStrength: number,
  sharpenMode: SharpenMode,
  numIterations: number
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-processing-'));

  try {
    console.log('Getting video info...');
    const videoInfo = await getVideoInfo(inputPath);
    console.log(`Video: ${videoInfo.width}x${videoInfo.height} @ ${videoInfo.fps.toFixed(2)}fps`);

    console.log('Extracting frames...');
    const frameCount = await extractFrames(inputPath, tempDir);

    console.log('Processing frames in parallel...');
    await processFrames(
      tempDir,
      frameCount,
      videoInfo,
      blurRadius,
      sharpenStrength,
      sharpenMode,
      numIterations
    );

    console.log('Reassembling video...');
    await reassembleVideo(tempDir, outputPath, inputPath, videoInfo);

  } finally {
    // Clean up temporary directory
    console.log('Cleaning up temporary files...');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
