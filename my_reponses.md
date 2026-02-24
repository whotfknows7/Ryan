# Actual User XP Data

You saw the "structure overview" earlier because the previous data source specifically described the table's *schema* (the blueprint defining the columns and data types) rather than the actual rows of data inside.

Here is a sample of the **real data** currently stored in your `UserXp` table showing actual members and their XP in a guild:

| User ID | Guild ID | All-Time XP | Daily XP | Weekly XP | Clan ID | Last Updated |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1341275034638880828 | 1227505156220784692 | 14857 | 0 | 0 | 0 | 2026-02-23 17:23:00 |
| 762715169351532555 | 1227505156220784692 | 14904 | 0 | 0 | 0 | 2026-02-23 17:23:00 |
| 1347972043668328549 | 1227505156220784692 | 4611 | 0 | 0 | 0 | 2026-02-23 17:23:00 |
| 1260583190691577930 | 1227505156220784692 | 2320 | 0 | 1 | 0 | 2026-02-23 17:23:00 |
| 1093371557931384864 | 1227505156220784692 | 1862 | 0 | 0 | 0 | 2026-02-23 17:23:00 |
| 1276548964300099635 | 1227505156220784692 | 761 | 0 | 0 | 0 | 2026-02-23 17:23:00 |
| 749767397497372762 | 1227505156220784692 | 709 | 0 | 0 | 0 | 2026-02-23 17:23:00 |
| 932226426722217995 | 1227505156220784692 | 659 | 0 | 0 | 0 | 2026-02-23 17:23:00 |
| 1170477664440692799 | 1227505156220784692 | 473 | 0 | 0 | 0 | 2026-02-23 17:23:00 |

As you can see, this tracks the `userId` along with how much total `xp` they have accumulated. Most users in this sample are currently in guild `1227505156220784692` with `0` clan ID, and their daily/weekly XP have recently been reset to 0 or 1.
