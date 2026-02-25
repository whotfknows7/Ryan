use std::fs;
use skrifa::{
    color::ColorGlyphFormat,
    outline::DrawSettings,
    setting::VariationSetting,
    FontRef, MetadataProvider,
};
use read_fonts::{
    tables::{colr::Colr, cpal::Cpal},
    TableProvider,
};

fn main() {
    let font_data = fs::read("../assets/fonts/ColrEmoji.ttf").unwrap();
    let font = FontRef::new(&font_data).unwrap();
    
    // Attempt accessing COLR and CPAL explicitly
    let colr = font.colr().unwrap();
    let cpal = font.cpal().unwrap();
    println!("COLR version: {}", colr.version());
    println!("CPAL num palettes: {}", cpal.num_palettes());

    // Try finding the glyph for an emoji
    let char_emoji = '😀';
    let charmap = font.charmap();
    let gid = charmap.map(char_emoji).unwrap();
    println!("Glyph ID for {}: {}", char_emoji, gid);

    let color_glyphs = font.color_glyphs();
    let color_glyph = color_glyphs.get_with_format(gid, ColorGlyphFormat::ColrV0).unwrap();
    
    // Let's see how many layers it has, or if we need to parse them manually
}
