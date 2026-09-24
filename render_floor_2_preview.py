"""Render data/garage/floor-2.json as a simple verification PNG."""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle
except ModuleNotFoundError:
    print(
        "Missing dependency: matplotlib. Install it with: "
        "python -m pip install matplotlib",
        file=sys.stderr,
    )
    raise SystemExit(2)


REPO_ROOT = Path(__file__).resolve().parent
REGISTRY_PATH = REPO_ROOT / "data" / "garage" / "floor-2.json"
PREVIEW_PATH = REPO_ROOT / "private" / "floor-2-preview.png"


def main() -> int:
    if not REGISTRY_PATH.is_file():
        print(f"Registry not found: {REGISTRY_PATH}", file=sys.stderr)
        return 1

    with REGISTRY_PATH.open("r", encoding="utf-8") as stream:
        registry = json.load(stream)

    bounds = registry["bounds"]
    drawing_width = bounds["maxX"] - bounds["minX"]
    drawing_height = bounds["maxY"] - bounds["minY"]
    aspect = drawing_width / drawing_height if drawing_height else 1
    figure_width = 16
    figure_height = min(16, max(6, figure_width / aspect))
    figure, axes = plt.subplots(figsize=(figure_width, figure_height))

    zone_colors = plt.get_cmap("tab10")
    for zone_index, zone in enumerate(registry["zones"]):
        boundary = zone["boundary"]
        if not boundary:
            continue
        closed_boundary = boundary + [boundary[0]]
        xs = [point[0] for point in closed_boundary]
        ys = [point[1] for point in closed_boundary]
        color = zone_colors(zone_index % 10)
        axes.plot(xs, ys, color=color, linewidth=1.6, zorder=3)
        label_x = sum(point[0] for point in boundary) / len(boundary)
        label_y = sum(point[1] for point in boundary) / len(boundary)
        axes.text(
            label_x,
            label_y,
            zone["id"],
            color=color,
            fontsize=7,
            fontweight="bold",
            ha="center",
            va="center",
            bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.75},
            zorder=5,
        )

    for stall in registry["stalls"]:
        left = stall["x"] - stall["width"] / 2
        bottom = stall["y"] - stall["height"] / 2
        axes.add_patch(
            Rectangle(
                (left, bottom),
                stall["width"],
                stall["height"],
                facecolor="#f4f5f7",
                edgecolor="#4b5563",
                linewidth=0.45,
                zorder=1,
            )
        )
        stall_number = stall["id"].rsplit("-S", maxsplit=1)[1]
        axes.text(
            stall["x"],
            stall["y"],
            stall_number,
            fontsize=2.8,
            ha="center",
            va="center",
            color="#111827",
            zorder=2,
        )

    padding = max(drawing_width, drawing_height) * 0.025
    axes.set_xlim(bounds["minX"] - padding, bounds["maxX"] + padding)
    # AutoCAD top view and matplotlib both use positive Y in the upward direction.
    axes.set_ylim(bounds["minY"] - padding, bounds["maxY"] + padding)
    axes.set_aspect("equal", adjustable="box")
    axes.set_title(
        f"{registry['floor']} parking registry — {registry['stall_count']} stalls"
    )
    axes.set_xlabel(f"X ({registry['units']})")
    axes.set_ylabel(f"Y ({registry['units']})")
    axes.grid(visible=True, linewidth=0.25, alpha=0.3)
    figure.tight_layout()

    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(PREVIEW_PATH, dpi=200, bbox_inches="tight")
    plt.close(figure)
    print(f"Preview written: {PREVIEW_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
