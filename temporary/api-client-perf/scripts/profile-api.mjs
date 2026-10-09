import { writeFileSync } from "node:fs";
import { API as BaseAPI } from "../../../packages/typescript/dist/api/sync/api.js";
import { binary } from "./config.mjs";
import { recordWire } from "./telemetry.mjs";
export * from "../../../packages/typescript/dist/api/sync/api.js";

const instances = [];
export class API extends BaseAPI {
    constructor(options) {
        super({
            ...options,
            tsserverPath: binary,
            collectTiming: process.env.API_TIMING === "1",
        });
        if (process.env.API_WIRE === "1") {
            const channel = this.client.channel;
            for (const name of ["requestSync", "requestBinarySync"]) {
                const original = channel[name];
                channel[name] = function (method, request) {
                    const response = original.call(this, method, request);
                    recordWire(method, request, response);
                    return response;
                };
            }
        }
        instances.push(this);
    }
}

if (process.env.API_TIMING === "1") {
    process.on("exit", () => {
        writeFileSync(process.env.API_TIMING_OUTPUT, JSON.stringify(instances.map(api => api.getTimingInfo()), null, 2));
    });
}
