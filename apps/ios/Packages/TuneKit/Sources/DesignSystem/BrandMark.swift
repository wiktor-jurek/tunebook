// The Tune Companion mark, drawn from the same geometry as apps/web/src/app/icon.svg: a repeat
// sign's dots and bar, then a tick for a tune learned. Orange dots, ink bar and tick, following
// light and dark mode as the web's does.

import SwiftUI

public struct BrandMark: View {
    public init() {}

    public var body: some View {
        Canvas { context, size in
            // The SVG's 100-unit box, shifted left by 1 as the SVG's group is.
            let s = min(size.width, size.height) / 100
            let x = { (value: Double) in (value - 1) * s }
            let y = { (value: Double) in value * s }
            for cy in [40.0, 60.0] {
                context.fill(Path(ellipseIn: CGRect(x: x(18 - 6.5), y: y(cy - 6.5), width: 13 * s, height: 13 * s)), with: .color(Palette.brandDot))
            }
            context.fill(Path(roundedRect: CGRect(x: x(28), y: y(17), width: 7.5 * s, height: 66 * s), cornerRadius: 3.75 * s),
                         with: .color(Palette.brandInk))
            var tick = Path()
            tick.move(to: CGPoint(x: x(46.5), y: y(47)))
            tick.addLine(to: CGPoint(x: x(54), y: y(76.5)))
            tick.addLine(to: CGPoint(x: x(86), y: y(23.5)))
            context.stroke(tick, with: .color(Palette.brandInk), style: StrokeStyle(lineWidth: 13 * s, lineCap: .round, lineJoin: .round))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
