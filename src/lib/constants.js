// src/lib/constants.js

module.exports = {
  // The Server where the GIFs live
  DEV_GUILD_ID: '1227505156220784692',
  ASSET_CHANNEL_ID: '1301183910838796460',

  // Message IDs containing the Winner GIFs
  GIF_MESSAGES: {
    CLAN_1_WIN: '1341915720719532104',
    CLAN_2_WIN: '1341915931542294694',
    TIE_WIN: '1348257621877981184',
    THUMBNAIL: '1341765089891586049',
  },

  // Mandatory Decorative Emojis (Must be in a server the bot is in)
  EMOJIS: {
    RANK_1: '<a:One:1310686608109862962>', // The '1' Emoji
    RANK_2: '<<a:pink_two:1310686637902004224>', // The '2' Emoji
    DASH_BLUE: '<:dash_blue:1310695526244552824>',
  },
};
