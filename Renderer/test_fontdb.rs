use std::fs;

fn main() {
    let mut db = fontdb::Database::new();
    let data = fs::read("assets/fonts/ColrEmoji.ttf").unwrap();
    db.load_font_data(data);
    println!("Faces: {}", db.faces().count());
    for face in db.faces() {
        println!("Family: {:?}", face.families);
    }
}
