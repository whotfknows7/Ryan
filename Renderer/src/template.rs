use crate::models::RenderRequest;

pub fn generate_rank_card_html(data: &RenderRequest) -> String {
    let sanitized_username = html_escape::encode_text(&data.username);
    let sanitized_color = sanitize_hex(&data.hex_color);
    
    format!(r#"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;500;700;900&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            width: 1000px;
            height: 300px;
            background: transparent;
            overflow: hidden;
            font-family: 'Outfit', sans-serif;
        }}
        
        .card-container {{
            width: 1000px;
            height: 300px;
            background: linear-gradient(135deg, rgba(20, 20, 30, 0.85) 0%, rgba(10, 10, 20, 0.9) 100%);
            border-radius: 24px;
            border: 2px solid {color};
            box-shadow: 
                0 0 60px {color}40,
                inset 0 0 60px rgba(255, 255, 255, 0.05),
                0 20px 40px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            display: flex;
            align-items: center;
            padding: 40px;
            position: relative;
            overflow: hidden;
        }}
        
        .card-container::before {{
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, {color}15 0%, transparent 70%);
            animation: pulse 4s ease-in-out infinite;
        }}
        
        @keyframes pulse {{
            0%, 100% {{ transform: scale(1); opacity: 0.5; }}
            50% {{ transform: scale(1.1); opacity: 0.8; }}
        }}
        
        .avatar-section {{
            position: relative;
            width: 200px;
            height: 200px;
            flex-shrink: 0;
            z-index: 1;
        }}
        
        .avatar-container {{
            width: 200px;
            height: 200px;
            border-radius: 50%;
            overflow: hidden;
            border: 4px solid {color};
            box-shadow: 0 0 30px {color}60;
        }}
        
        .avatar-container img {{
            width: 100%;
            height: 100%;
            object-fit: cover;
        }}
        
        .info-section {{
            flex: 1;
            margin-left: 50px;
            z-index: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }}
        
        .display-name {{
            font-size: 56px;
            font-weight: 900;
            color: #ffffff;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-bottom: 40px;
            text-shadow: 0 0 30px {color}80;
            font-family: 'Rajdhani', sans-serif;
            animation: fadeInDown 0.8s ease-out;
        }}
        
        @keyframes fadeInDown {{
            from {{
                opacity: 0;
                transform: translateY(-20px);
            }}
            to {{
                opacity: 1;
                transform: translateY(0);
            }}
        }}
        
        .pills-container {{
            display: flex;
            gap: 20px;
            animation: fadeInUp 0.8s ease-out 0.4s both;
        }}
        
        .pill {{
            background: rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            padding: 20px 30px;
            border: 2px solid rgba(255, 255, 255, 0.15);
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 15px;
            box-shadow: 
                0 4px 20px rgba(0, 0, 0, 0.3),
                inset 0 1px 1px rgba(255, 255, 255, 0.1);
        }}
        
        .pill-row {{
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}
        
        .pill-label {{
            font-size: 14px;
            color: rgba(255, 255, 255, 0.6);
            text-transform: uppercase;
            letter-spacing: 1.5px;
            font-weight: 500;
        }}
        
        .pill-value {{
            font-size: 28px;
            font-weight: 700;
            color: #ffffff;
            font-family: 'Rajdhani', sans-serif;
            text-shadow: 0 0 10px {color}60;
        }}
        
        .pill-divider {{
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
        }}
        
        @keyframes fadeInUp {{
            from {{
                opacity: 0;
                transform: translateY(20px);
            }}
            to {{
                opacity: 1;
                transform: translateY(0);
            }}
        }}
    </style>
</head>
<body>
    <div class="card-container">
        <div class="avatar-section">
            <div class="avatar-container">
                <img src="data:image/png;base64,{avatar}" alt="avatar"/>
            </div>
        </div>
        
        <div class="info-section">
            <h1 class="display-name">{username}</h1>
            
            <div class="pills-container">
                <!-- PILL 1: XP (Weekly / All-Time) -->
                <div class="pill">
                    <div class="pill-row">
                        <span class="pill-label">Weekly</span>
                        <span class="pill-value">{weekly_xp}</span>
                    </div>
                    <div class="pill-divider"></div>
                    <div class="pill-row">
                        <span class="pill-label">Total</span>
                        <span class="pill-value">{all_time_xp}</span>
                    </div>
                </div>
                
                <!-- PILL 2: Rank (Weekly / All-Time) -->
                <div class="pill">
                    <div class="pill-row">
                        <span class="pill-label">W-Rank</span>
                        <span class="pill-value">#{weekly_rank}</span>
                    </div>
                    <div class="pill-divider"></div>
                    <div class="pill-row">
                        <span class="pill-label">T-Rank</span>
                        <span class="pill-value">#{all_time_rank}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Ensure animations complete before screenshot
        document.addEventListener('DOMContentLoaded', () => {{
            window.cardReady = true;
        }});
    </script>
</body>
</html>
"#,
        color = sanitized_color,
        username = sanitized_username,
        avatar = data.avatar_base64,
        weekly_xp = data.weekly_xp,
        all_time_xp = data.all_time_xp,
        weekly_rank = data.weekly_rank,
        all_time_rank = data.all_time_rank,
    )
}

fn sanitize_hex(hex: &str) -> String {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("#{}", hex)
    } else {
        "#00d4ff".to_string() // fallback cyan
    }
}
