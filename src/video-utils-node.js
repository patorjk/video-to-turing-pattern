"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processVideoWithFilter = processVideoWithFilter;
var fs = require("fs");
var path = require("path");
var os = require("os");
var worker_threads_1 = require("worker_threads");
var fluent_ffmpeg_1 = require("fluent-ffmpeg");
function getVideoInfo(inputPath) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    fluent_ffmpeg_1.default.ffprobe(inputPath, function (err, metadata) {
                        if (err) {
                            reject(err);
                            return;
                        }
                        var videoStream = metadata.streams.find(function (s) { return s.codec_type === 'video'; });
                        if (!videoStream) {
                            reject(new Error('No video stream found'));
                            return;
                        }
                        var fps = videoStream.r_frame_rate
                            ? eval(videoStream.r_frame_rate)
                            : 30;
                        resolve({
                            width: videoStream.width || 0,
                            height: videoStream.height || 0,
                            fps: fps,
                            duration: metadata.format.duration || 0
                        });
                    });
                })];
        });
    });
}
function extractFrames(inputPath, tempDir) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var frameCount = 0;
                    (0, fluent_ffmpeg_1.default)(inputPath)
                        .outputOptions([
                        '-vf', 'fps=fps=30',
                    ])
                        .output(path.join(tempDir, 'frame-%06d.png'))
                        .on('progress', function (progress) {
                        if (progress.frames) {
                            frameCount = progress.frames;
                        }
                    })
                        .on('end', function () {
                        console.log("Extracted ".concat(frameCount, " frames"));
                        resolve(frameCount);
                    })
                        .on('error', function (err) {
                        reject(err);
                    })
                        .run();
                })];
        });
    });
}
function processFrames(tempDir, frameCount, videoInfo, blurRadius, sharpenStrength, sharpenMode, numIterations) {
    return __awaiter(this, void 0, void 0, function () {
        var maxWorkers, workerScript, processedCount, activeWorkers, frameQueue, i, framePath;
        return __generator(this, function (_a) {
            maxWorkers = os.cpus().length;
            workerScript = path.join(__dirname, 'frame-worker.js');
            console.log("Processing frames with ".concat(maxWorkers, " parallel workers..."));
            processedCount = 0;
            activeWorkers = 0;
            frameQueue = [];
            for (i = 1; i <= frameCount; i++) {
                framePath = path.join(tempDir, "frame-".concat(String(i).padStart(6, '0'), ".png"));
                if (fs.existsSync(framePath)) {
                    frameQueue.push(i);
                }
            }
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var processNextFrame = function () {
                        if (frameQueue.length === 0) {
                            if (activeWorkers === 0) {
                                resolve();
                            }
                            return;
                        }
                        var frameNum = frameQueue.shift();
                        var framePath = path.join(tempDir, "frame-".concat(String(frameNum).padStart(6, '0'), ".png"));
                        activeWorkers++;
                        var worker = new worker_threads_1.Worker(workerScript, {
                            workerData: {
                                framePath: framePath,
                                blurRadius: blurRadius,
                                sharpenStrength: sharpenStrength,
                                sharpenMode: sharpenMode,
                                numIterations: numIterations,
                                // To create the effect where a video gradually transitions into a Turing Pattern, use the below line
                                //numIterations: Math.max(0, frameNum - 30 * 7),
                                width: videoInfo.width,
                                height: videoInfo.height
                            }
                        });
                        worker.on('message', function (message) {
                            activeWorkers--;
                            processedCount++;
                            if (message.success) {
                                console.log("- Processed frame ".concat(processedCount, "/").concat(frameCount));
                            }
                            else {
                                console.error("Error processing frame ".concat(frameNum, ":"), message.error);
                            }
                            worker.terminate();
                            processNextFrame();
                        });
                        worker.on('error', function (error) {
                            activeWorkers--;
                            console.error("Worker error on frame ".concat(frameNum, ":"), error);
                            worker.terminate();
                            processNextFrame();
                        });
                        worker.on('exit', function (code) {
                            if (code !== 0) {
                                console.error("Worker stopped with exit code ".concat(code));
                            }
                        });
                    };
                    for (var i = 0; i < maxWorkers && i < frameQueue.length; i++) {
                        processNextFrame();
                    }
                })];
        });
    });
}
function reassembleVideo(tempDir, outputPath, inputPath, videoInfo) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var command = (0, fluent_ffmpeg_1.default)();
                    // Add processed frames as input
                    command.input(path.join(tempDir, 'frame-%06d.png'))
                        .inputFPS(videoInfo.fps);
                    // Add original video as input for audio
                    command.input(inputPath);
                    // Map video from first input and audio from second input
                    command.outputOptions([
                        '-map', '0:v:0', // Video from first input (processed frames)
                        '-map', '1:a:0?', // Audio from second input (original video), ? makes it optional
                        '-c:v', 'libx264',
                        '-preset', 'medium',
                        '-crf', '18',
                        '-c:a', 'copy', // Copy audio without re-encoding
                        '-pix_fmt', 'yuv420p'
                    ]);
                    command.output(outputPath)
                        .on('progress', function (progress) {
                        var _a;
                        console.log("Encoding: ".concat((_a = progress.percent) === null || _a === void 0 ? void 0 : _a.toFixed(1), "% done"));
                    })
                        .on('end', function () {
                        console.log('Video reassembly complete');
                        resolve();
                    })
                        .on('error', function (err) {
                        reject(err);
                    })
                        .run();
                })];
        });
    });
}
function processVideoWithFilter(inputPath, outputPath, blurRadius, sharpenStrength, sharpenMode, numIterations) {
    return __awaiter(this, void 0, void 0, function () {
        var tempDir, videoInfo, frameCount;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-processing-'));
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 6, 7]);
                    console.log('Getting video info...');
                    return [4 /*yield*/, getVideoInfo(inputPath)];
                case 2:
                    videoInfo = _a.sent();
                    console.log("Video: ".concat(videoInfo.width, "x").concat(videoInfo.height, " @ ").concat(videoInfo.fps.toFixed(2), "fps"));
                    console.log('Extracting frames...');
                    return [4 /*yield*/, extractFrames(inputPath, tempDir)];
                case 3:
                    frameCount = _a.sent();
                    console.log('Processing frames in parallel...');
                    return [4 /*yield*/, processFrames(tempDir, frameCount, videoInfo, blurRadius, sharpenStrength, sharpenMode, numIterations)];
                case 4:
                    _a.sent();
                    console.log('Reassembling video...');
                    return [4 /*yield*/, reassembleVideo(tempDir, outputPath, inputPath, videoInfo)];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 7];
                case 6:
                    // Clean up temporary directory
                    console.log('Cleaning up temporary files...');
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/];
            }
        });
    });
}
