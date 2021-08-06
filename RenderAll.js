// ****************************************************************************
// * This increadibly scuffed js file will render all the ground chart svg    *
// * files into png files, and place them in a newly created __Results        *
// * folder. It requires Node.js, Inkscape and ImageMagick to be installed.   *
// * Put the path to these programs in the settings object below. This has    *
// * only been tested with Inkscape 1.1 and ImageMagick 7.1.0 on a Windows 10 *
// * system. This will likely be replaced with some sort of continuous        *
// * integration at a later point. For now, run this with `node RenderAll.js` *
// ****************************************************************************

// @ts-check
"use strict";

// Settings
const settings = {
    inkscapeCommand: "C:\\Program Files\\Inkscape\\Bin\\Inkscape.com",
    magickCommand: "C:\\Program Files\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe",
    configs: [
        {
            dpi: 192,
            exportDir: "__Results",
        }
    ],
};

///////////////////////////////////////////////////////////////////////////////

const { spawn, exec } = require("child_process");
const { statSync, mkdirSync, readdirSync } = require("fs");
const { extname } = require("path");
const { configs, inkscapeCommand, magickCommand } = settings;
let cancelled = false;
let anyKeyExit = false;

// First message
console.log(
    "Rendering Charts:\n" +
    configs.map(({ dpi, exportDir }) =>
        `    Exporting to ${exportDir}/light\n` +
        `    with dpi ${dpi}\n`
    ).join("and\n") +
    "\nPress \"q\" at any point to quit."
);


configs.forEach(({ exportDir }) => {
    mkdirSync(`./${exportDir}/light`, { recursive: true });
    mkdirSync(`./${exportDir}/dark`, { recursive: true });
});

/**
 * Filter non-airport folders
 * @param {string} file
*/
const filter = (file) =>
    file.charAt(0) !== "_" && statSync(`./${file}`).isDirectory();


// *******************************
// * Get the paths of all charts *
// *******************************

const paths = [];
const charts = [];

// Islands
readdirSync(".").forEach((island) => {
    if (!filter(island)) return;

    // Airports
    readdirSync(`./${island}`).forEach((airport) => {
        if (!filter(`./${island}/${airport}`)) return;

        // Charts
        readdirSync(`./${island}/${airport}`).forEach(
            async (chart) => {
                if (extname(chart) !== ".svg") return;

                paths.push(`${island}/${airport}/${chart}`);
                charts.push(chart);
            }
        );
    });
});


// ******************************************
// * Generate the Inkscape CLI instructions *
// ******************************************

const actions =
    "export-background-opacity:255; " +
    configs.map(({ dpi, exportDir }) => 
        `export-dpi:${dpi}; ` +
        paths.map((path, i) => 
            `file-open:${path}; ` +
            `export-filename:${
                exportDir}/light/${charts[i].split(".")[0]
            }.png; ` +
            "export-do; " +
            "file-close;"
        ).join("")
    ).join("");

// Spawn inkscape
const Inkscape = spawn(
    inkscapeCommand,
    [`--actions=${actions}`]
);

// **********************
// * Calculate Progress *
// **********************
//
// Inkscape outputs the background colour every time it exports. We search for
// this string and count it to see how many exports it has done. We can then
// get the percentage complete from the amount of charts times the amount of
// configs.

// Inkscape.stdout.pipe(process.stdout);
// Inkscape.stderr.pipe(process.stderr);

let childout = ""
const denominator = charts.length * configs.length;

Inkscape.stderr.on("data", chunk => {
    childout += chunk;
    const numerator = childout.match(/Background RRGGBBAA/g)?.length || 0;
    const percent = Math.round(numerator / denominator * 100);
    process.stdout.write(`\r\x1b[33m${percent}%\x1b[0m`);
});

// ***********
// * On exit *
// ***********
let Magick;

Inkscape.on("exit", () => {
    configs.forEach(({ exportDir }) => {
        readdirSync(`./${exportDir}`);
    });

    // Go through each export dir, find the count of the pngs and add them.
    const resultCount = configs.map(({ exportDir }) => 
        readdirSync(`./${exportDir}/light`).filter(
            file => extname(file) === ".png"
        ).length
    ).reduce((o, n) => o + n, 0);

    const expectedCount = charts.length * configs.length;

    if (cancelled === true) {
        console.log(
            "\n\x1b[31mCancelled rendering charts. Charts which have been " +
            "rendered until this point have been saved.\x1b[0m"
        );
        console.log("Press any key to exit . . .");
        anyKeyExit = true;
    }
    else if (resultCount < expectedCount) {
        console.error(
            "\n\x1b[31mThere are less pngs in the export directories then " +
            `there expected. There should be ${expectedCount} charts but ` +
            `only ${resultCount} .png files were found. Ensure all charts ` +
            "were exported correctly.\x1b[0m"
        );
        console.log("Press any key to exit . . .");
        anyKeyExit = true;
    }
    else {
        console.log(
            "\n\x1b[32mDone Inkscape!\x1b[0m\n" +
            "Generating dark mode:\n" +
            configs.map(({ exportDir }) =>
                `    Exporting to ${exportDir}/dark\n`
            ).join("and\n")
        );

        const execStr = configs.map(({ exportDir }) => 
            `"${magickCommand}" convert -modulate 100,100,0 -channel RGB ` +
            `-negate "./${exportDir}/light/*.png" -verbose -set ` +
            `filename:original %t "./${exportDir}/dark/%[filename:original]` +
            '.png"'
        ).join(" & ");

        Magick = exec(execStr);

        let childout = "";
        Magick.stdout.on("data", chunk => {
            childout += chunk;
            const numerator = childout.match(/sRGB/g)?.length || 0;
            const percent = Math.round(numerator / denominator * 100);
            process.stdout.write(`\r\x1b[33m${percent}%\x1b[0m`);
        });

        Magick.on("exit", () => {
            console.log("Press any key to exit . . .");
            anyKeyExit = true;
        });
    };
});

process.stdin.setRawMode(true).on("data", chunk => {
    if (anyKeyExit) return process.stdin.destroy();

    if (chunk.toString().match("q")) {
        cancelled = true;
        Inkscape.kill();
        Magick.kill?.();
    };
});
