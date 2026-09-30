import "./style.css";
import { Engine } from "./core/engine";
import { registerMode } from "./core/registry";
import { createPixelMode, validatePixelLevel } from "./modes/pixel";
import { App } from "./ui/app";

registerMode("pixel", createPixelMode, validatePixelLevel);

const canvas = document.getElementById("game") as HTMLCanvasElement;
const root = document.getElementById("app") as HTMLElement;
const app = new App(root, canvas, new Engine(canvas));
void app.init();
