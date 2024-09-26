"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var pino_1 = require("pino");
var transport = pino_1.default.transport({
    target: 'pino-pretty',
});
exports.logger = (0, pino_1.default)({
    level: 'info',
    redact: ['poolKeys'],
    serializers: {
        error: pino_1.default.stdSerializers.err,
    },
    base: undefined,
}, transport);
