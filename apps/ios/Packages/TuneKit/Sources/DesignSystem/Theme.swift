// Hand-written companions to the generated Tokens.swift: colours that follow light and dark mode,
// and the type the web uses (serif for tune titles, as --font-music).

import SwiftUI
import UIKit

extension Color {
    /// A colour that follows the system appearance, from two 0xRRGGBB values.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

public extension Font {
    /// Tune titles, as the web's --font-music.
    static func tuneTitle(_ style: Font.TextStyle = .title) -> Font { .system(style, design: .serif) }
}
