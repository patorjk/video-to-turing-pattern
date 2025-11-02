"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageProcessor = void 0;
var canvas_1 = require("@napi-rs/canvas");
var ImageProcessor = /** @class */ (function () {
    function ImageProcessor() {
    }
    ImageProcessor.rgbToLab = function (r, g, b) {
        var rNorm = r / 255;
        var gNorm = g / 255;
        var bNorm = b / 255;
        rNorm =
            rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
        gNorm =
            gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
        bNorm =
            bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;
        var x = (rNorm * 0.4124 + gNorm * 0.3576 + bNorm * 0.1805) / 0.95047;
        var y = (rNorm * 0.2126 + gNorm * 0.7152 + bNorm * 0.0722) / 1.0;
        var z = (rNorm * 0.0193 + gNorm * 0.1192 + bNorm * 0.9505) / 1.08883;
        x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
        y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
        z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
        return {
            l: 116 * y - 16,
            a: 500 * (x - y),
            b: 200 * (y - z),
        };
    };
    ImageProcessor.labToRgb = function (l, a, b) {
        var y = (l + 16) / 116;
        var x = a / 500 + y;
        var z = y - b / 200;
        x = 0.95047 * (x * x * x > 0.008856 ? x * x * x : (x - 16 / 116) / 7.787);
        y = 1.0 * (y * y * y > 0.008856 ? y * y * y : (y - 16 / 116) / 7.787);
        z = 1.08883 * (z * z * z > 0.008856 ? z * z * z : (z - 16 / 116) / 7.787);
        var r = x * 3.2406 + y * -1.5372 + z * -0.4986;
        var g = x * -0.9689 + y * 1.8758 + z * 0.0415;
        var bl = x * 0.0557 + y * -0.204 + z * 1.057;
        r = r > 0.0031308 ? 1.055 * Math.pow(r, 1 / 2.4) - 0.055 : 12.92 * r;
        g = g > 0.0031308 ? 1.055 * Math.pow(g, 1 / 2.4) - 0.055 : 12.92 * g;
        bl = bl > 0.0031308 ? 1.055 * Math.pow(bl, 1 / 2.4) - 0.055 : 12.92 * bl;
        return {
            r: Math.max(0, Math.min(255, r * 255)),
            g: Math.max(0, Math.min(255, g * 255)),
            b: Math.max(0, Math.min(255, bl * 255)),
        };
    };
    ImageProcessor.gaussianBlur = function (imageData, radius) {
        var w = imageData.width;
        var h = imageData.height;
        var data = imageData.data;
        var output = new Uint8ClampedArray(data);
        var kernel = [];
        var kernelSum = 0;
        var sigma = radius / 3;
        var size = radius * 2 + 1;
        for (var i = 0; i < size; i++) {
            var x = i - radius;
            var value = Math.exp(-(x * x) / (2 * sigma * sigma));
            kernel.push(value);
            kernelSum += value;
        }
        for (var i = 0; i < kernel.length; i++) {
            kernel[i] /= kernelSum;
        }
        var temp = new Uint8ClampedArray(data.length);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var r = 0, g = 0, b = 0;
                for (var k = 0; k < size; k++) {
                    var sx = Math.max(0, Math.min(w - 1, x + k - radius));
                    var idx_1 = (y * w + sx) * 4;
                    r += data[idx_1] * kernel[k];
                    g += data[idx_1 + 1] * kernel[k];
                    b += data[idx_1 + 2] * kernel[k];
                }
                var idx = (y * w + x) * 4;
                temp[idx] = r;
                temp[idx + 1] = g;
                temp[idx + 2] = b;
                temp[idx + 3] = data[idx + 3];
            }
        }
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var r = 0, g = 0, b = 0;
                for (var k = 0; k < size; k++) {
                    var sy = Math.max(0, Math.min(h - 1, y + k - radius));
                    var idx_2 = (sy * w + x) * 4;
                    r += temp[idx_2] * kernel[k];
                    g += temp[idx_2 + 1] * kernel[k];
                    b += temp[idx_2 + 2] * kernel[k];
                }
                var idx = (y * w + x) * 4;
                output[idx] = r;
                output[idx + 1] = g;
                output[idx + 2] = b;
                output[idx + 3] = temp[idx + 3];
            }
        }
        return new canvas_1.ImageData(output, w, h);
    };
    ImageProcessor.sharpenImage = function (imageData, strength, mode) {
        var w = imageData.width;
        var h = imageData.height;
        var data = imageData.data;
        var output = new Uint8ClampedArray(data);
        if (mode === "rgb") {
            var center = 1 + 4 * strength;
            var edge = -strength;
            for (var y = 1; y < h - 1; y++) {
                for (var x = 1; x < w - 1; x++) {
                    for (var c = 0; c < 3; c++) {
                        var idx = (y * w + x) * 4 + c;
                        var value = data[idx] * center +
                            data[((y - 1) * w + x) * 4 + c] * edge +
                            data[((y + 1) * w + x) * 4 + c] * edge +
                            data[(y * w + (x - 1)) * 4 + c] * edge +
                            data[(y * w + (x + 1)) * 4 + c] * edge;
                        output[idx] = Math.max(0, Math.min(255, value));
                    }
                }
            }
        }
        else {
            var labData = new Float32Array(w * h * 3);
            for (var i = 0; i < w * h; i++) {
                var r = data[i * 4];
                var g = data[i * 4 + 1];
                var b = data[i * 4 + 2];
                var lab = this.rgbToLab(r, g, b);
                labData[i * 3] = lab.l;
                labData[i * 3 + 1] = lab.a;
                labData[i * 3 + 2] = lab.b;
            }
            var center = 1 + 4 * strength;
            var edge = -strength;
            var labOutput = new Float32Array(labData);
            for (var y = 1; y < h - 1; y++) {
                for (var x = 1; x < w - 1; x++) {
                    var idx = (y * w + x) * 3;
                    var value = labData[idx] * center +
                        labData[((y - 1) * w + x) * 3] * edge +
                        labData[((y + 1) * w + x) * 3] * edge +
                        labData[(y * w + (x - 1)) * 3] * edge +
                        labData[(y * w + (x + 1)) * 3] * edge;
                    labOutput[idx] = Math.max(0, Math.min(100, value));
                }
            }
            for (var i = 0; i < w * h; i++) {
                var l = labOutput[i * 3];
                var a = labOutput[i * 3 + 1];
                var b = labOutput[i * 3 + 2];
                var rgb = this.labToRgb(l, a, b);
                output[i * 4] = rgb.r;
                output[i * 4 + 1] = rgb.g;
                output[i * 4 + 2] = rgb.b;
            }
        }
        return new canvas_1.ImageData(output, w, h);
    };
    return ImageProcessor;
}());
exports.ImageProcessor = ImageProcessor;
