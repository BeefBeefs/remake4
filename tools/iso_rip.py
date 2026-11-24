#!/usr/bin/env python3
"""Read an ISO9660 filesystem from a raw MODE2/2352 (or MODE1/2352) BIN track.

Usage: python3 -I iso_rip.py <bin> list
       python3 -I iso_rip.py <bin> extract <outdir>
Files recorded as XA Form2 (e.g. STR video / XA audio) are extracted as raw 2352-byte sectors
into <name>.raw2352 so nothing is lost.
"""
import sys, os, struct

SS = 2352


class Disc:
    def __init__(self, path):
        self.f = open(path, "rb")
        self.size = os.path.getsize(path)
        self.nsec = self.size // SS
        # detect mode from sector 16
        self.f.seek(16 * SS)
        s = self.f.read(SS)
        if s[:12] != b"\x00" + b"\xff" * 10 + b"\x00":
            raise ValueError("no sync in sector 16")
        self.mode = s[15]
        self.off = 24 if self.mode == 2 else 16

    def sector_raw(self, lba):
        self.f.seek(lba * SS)
        return self.f.read(SS)

    def user(self, lba):
        s = self.sector_raw(lba)
        if self.mode == 2:
            sub = s[18]  # submode byte (copy)
            if sub & 0x20:  # form2
                return s[24:24 + 2324], True
            return s[24:24 + 2048], False
        return s[16:16 + 2048], False


def parse_dir(d, lba, size, path=""):
    out = []
    data = b""
    nsec = (size + 2047) // 2048
    for i in range(nsec):
        u, _ = d.user(lba + i)
        data += u
    data = data[:size]
    p = 0
    while p < len(data):
        ln = data[p]
        if ln == 0:
            p = (p // 2048 + 1) * 2048
            continue
        rec = data[p:p + ln]
        p += ln
        loc = struct.unpack("<I", rec[2:6])[0]
        sz = struct.unpack("<I", rec[10:14])[0]
        flags = rec[25]
        nlen = rec[32]
        name = rec[33:33 + nlen]
        if name in (b"\x00", b"\x01"):
            continue
        name = name.decode("latin-1")
        if ";" in name:
            name = name.split(";")[0]
        full = path + "/" + name
        if flags & 2:
            out.append((full, loc, sz, True))
            out.extend(parse_dir(d, loc, sz, full))
        else:
            out.append((full, loc, sz, False))
    return out


def main():
    binp, cmd = sys.argv[1], sys.argv[2]
    d = Disc(binp)
    pvd, _ = d.user(16)
    assert pvd[1:6] == b"CD001", "no PVD"
    print("sectors:", d.nsec, "mode", d.mode)
    print("system id:", pvd[8:40].decode("latin-1").strip())
    print("volume id:", pvd[40:72].decode("latin-1").strip())
    root = pvd[156:190]
    rloc = struct.unpack("<I", root[2:6])[0]
    rsz = struct.unpack("<I", root[10:14])[0]
    entries = parse_dir(d, rloc, rsz)
    if cmd == "list":
        for n, loc, sz, isd in entries:
            print("%s %10d lba=%-7d %s" % ("D" if isd else "F", sz, loc, n))
        return
    out = sys.argv[3]
    for n, loc, sz, isd in entries:
        p = os.path.join(out, *n.strip("/").split("/"))
        if isd:
            os.makedirs(p, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        nsec = (sz + 2047) // 2048
        # check if any sector is form2
        first = d.sector_raw(loc)
        form2 = d.mode == 2 and (first[18] & 0x20)
        if form2:
            with open(p + ".raw2352", "wb") as w:
                for i in range(nsec):
                    w.write(d.sector_raw(loc + i))
            continue
        with open(p, "wb") as w:
            left = sz
            for i in range(nsec):
                u, _ = d.user(loc + i)
                w.write(u[:min(2048, left)])
                left -= 2048
    print("done")


main()
