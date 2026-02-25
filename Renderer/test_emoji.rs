use std::fs;
use std::sync::Arc;
use usvg::{fontdb, Options, Tree, TreeParsing, TreePostProc};
use resvg::tiny_skia::Pixmap;

fn main() {
    let mut fontdb = fontdb::Database::new();
    fontdb.load_font_data(fs::read("../assets/fonts/ColrEmoji.ttf").unwrap());
    let fontdb = Arc::new(fontdb);

    let svg_str = r#"
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
            <text x="50" y="100" font-family="ColrEmoji" font-size="50" fill="white">😀🥺🚀</text>
        </svg>
    "#;

    let mut opt = Options::default();
    opt.font_family = "ColrEmoji".to_string();

    let mut rtree = Tree::from_str(svg_str, &opt).unwrap();
    rtree.postprocess(usvg::PostProcessingSteps::default(), &fontdb);

    let mut pixmap = Pixmap::new(200, 200).unwrap();
    resvg::render(&rtree, usvg::Transform::default(), &mut pixmap.as_mut());
    pixmap.save_png("test_emoji.png").unwrap();
    println!("Saved test_emoji.png");
}
