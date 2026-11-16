"""Strip EXIF/XMP metadata from JPEGs so uploaded photos don't leak the reporter's
GPS position or device details. Dependency-free: we only drop APPn segments."""


def strip_jpeg_metadata(data: bytes) -> bytes:
    if data[:2] != b"\xff\xd8":
        return data
    out = bytearray(b"\xff\xd8")
    i = 2
    n = len(data)
    while i + 4 <= n:
        if data[i] != 0xFF:
            return data  # malformed; keep original rather than corrupt it
        marker = data[i + 1]
        if marker == 0xDA:  # start of scan: copy the rest verbatim
            out += data[i:]
            return bytes(out)
        seg_len = int.from_bytes(data[i + 2 : i + 4], "big")
        if seg_len < 2 or i + 2 + seg_len > n:
            return data
        # APP1 (EXIF/XMP) through APP15 are dropped; APP0 (JFIF) and APP14 (Adobe colour) kept.
        if not (0xE1 <= marker <= 0xEF and marker != 0xEE):
            out += data[i : i + 2 + seg_len]
        i += 2 + seg_len
    return data
