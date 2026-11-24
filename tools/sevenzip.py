#!/usr/bin/env python3
"""Minimal 7z reader/extractor using only the Python stdlib.

Supports: LZMA, LZMA2, BCJ/ARM/PPC/SPARC/IA64/ARMT filters, Delta, Copy, Deflate, BZip2.
Linear coder chains only (no BCJ2, no PPMd, no AES).

Usage: python3 -I sevenzip.py list <archive>
       python3 -I sevenzip.py extract <archive> <outdir>
"""
import sys, os, struct, zlib, lzma, bz2

SIG = b"7z\xbc\xaf\x27\x1c"
CHUNK = 1 << 20


class R:
    def __init__(s, b):
        s.b = b
        s.p = 0

    def u8(s):
        v = s.b[s.p]
        s.p += 1
        return v

    def read(s, n):
        v = s.b[s.p:s.p + n]
        if len(v) != n:
            raise ValueError("truncated header")
        s.p += n
        return v

    def u32(s):
        return struct.unpack("<I", s.read(4))[0]

    def num(s):
        first = s.u8()
        mask = 0x80
        val = 0
        for i in range(8):
            if (first & mask) == 0:
                return val + ((first & (mask - 1)) << (8 * i))
            val |= s.u8() << (8 * i)
            mask >>= 1
        return val

    def bits(s, n):
        out = []
        cur = 0
        mask = 0
        for _ in range(n):
            if mask == 0:
                cur = s.u8()
                mask = 0x80
            out.append(bool(cur & mask))
            mask >>= 1
        return out

    def bits_defined(s, n):
        if s.u8():
            return [True] * n
        return s.bits(n)


class Folder:
    pass


def read_digests(r, n):
    defined = r.bits_defined(n)
    crcs = []
    for d in defined:
        crcs.append(r.u32() if d else None)
    return crcs


def read_folder(r):
    f = Folder()
    nc = r.num()
    f.coders = []
    tin = tout = 0
    for _ in range(nc):
        flag = r.u8()
        idsize = flag & 0xF
        cid = bytes(r.read(idsize))
        nin = nout = 1
        if flag & 0x10:
            nin = r.num()
            nout = r.num()
        props = b""
        if flag & 0x20:
            props = bytes(r.read(r.num()))
        f.coders.append((cid, nin, nout, props))
        tin += nin
        tout += nout
    f.total_in, f.total_out = tin, tout
    nb = tout - 1
    f.bind = [(r.num(), r.num()) for _ in range(nb)]  # (in_index, out_index)
    npk = tin - nb
    if npk == 1:
        bound_in = {b[0] for b in f.bind}
        f.packed = [i for i in range(tin) if i not in bound_in][:1]
    else:
        f.packed = [r.num() for _ in range(npk)]
    f.unpack_sizes = []
    f.crc = None
    return f


def read_streams_info(r):
    si = {"pack_pos": 0, "pack_sizes": [], "folders": [], "substreams": None}
    while True:
        pid = r.num()
        if pid == 0:
            break
        if pid == 6:
            si["pack_pos"] = r.num()
            n = r.num()
            while True:
                q = r.num()
                if q == 0:
                    break
                if q == 9:
                    si["pack_sizes"] = [r.num() for _ in range(n)]
                elif q == 0xA:
                    read_digests(r, n)
                else:
                    raise ValueError("bad PackInfo prop %d" % q)
        elif pid == 7:
            if r.num() != 0xB:
                raise ValueError("expected Folder")
            nf = r.num()
            if r.u8() != 0:
                raise ValueError("external folders unsupported")
            si["folders"] = [read_folder(r) for _ in range(nf)]
            if r.num() != 0xC:
                raise ValueError("expected CodersUnpackSize")
            for f in si["folders"]:
                f.unpack_sizes = [r.num() for _ in range(f.total_out)]
            while True:
                q = r.num()
                if q == 0:
                    break
                if q == 0xA:
                    crcs = read_digests(r, nf)
                    for f, c in zip(si["folders"], crcs):
                        f.crc = c
                else:
                    raise ValueError("bad UnpackInfo prop %d" % q)
        elif pid == 8:
            folders = si["folders"]
            counts = [1] * len(folders)
            sizes = None
            while True:
                q = r.num()
                if q == 0:
                    break
                if q == 0xD:
                    counts = [r.num() for _ in folders]
                elif q == 9:
                    sizes = []
                    for f, c in zip(folders, counts):
                        if c == 0:
                            continue
                        tot = 0
                        for _ in range(c - 1):
                            s = r.num()
                            sizes.append(s)
                            tot += s
                        sizes.append(folder_unpack_size(f) - tot)
                elif q == 0xA:
                    need = 0
                    for f, c in zip(folders, counts):
                        if not (c == 1 and f.crc is not None):
                            need += c
                    read_digests(r, need)
                else:
                    raise ValueError("bad SubStreams prop %d" % q)
            if sizes is None:
                sizes = []
                for f, c in zip(folders, counts):
                    if c == 1:
                        sizes.append(folder_unpack_size(f))
                    elif c > 1:
                        raise ValueError("missing substream sizes")
            si["substreams"] = (counts, sizes)
        else:
            raise ValueError("bad StreamsInfo prop %d" % pid)
    if si["substreams"] is None:
        si["substreams"] = ([1] * len(si["folders"]), [folder_unpack_size(f) for f in si["folders"]])
    return si


def folder_unpack_size(f):
    bound_out = {b[1] for b in f.bind}
    for i in range(f.total_out):
        if i not in bound_out:
            return f.unpack_sizes[i]
    raise ValueError("no main out stream")


def read_files_info(r):
    n = r.num()
    names = [None] * n
    empty_stream = [False] * n
    empty_file = None
    attrs = [None] * n
    while True:
        pid = r.num()
        if pid == 0:
            break
        size = r.num()
        end = r.p + size
        if pid == 0xE:
            empty_stream = r.bits(n)
        elif pid == 0xF:
            empty_file = r.bits(sum(empty_stream))
        elif pid == 0x11:
            if r.u8() != 0:
                raise ValueError("external names unsupported")
            raw = bytes(r.b[r.p:end])
            parts = raw.decode("utf-16-le").split("\x00")
            names = parts[:n]
        elif pid == 0x15:
            defined = r.bits_defined(n)
            if r.u8() != 0:
                raise ValueError("external attrs unsupported")
            for i, d in enumerate(defined):
                if d:
                    attrs[i] = r.u32()
        r.p = end
    files = []
    ei = 0
    for i in range(n):
        is_dir = False
        has_stream = not empty_stream[i]
        if empty_stream[i]:
            is_empty_file = bool(empty_file[ei]) if empty_file else False
            ei += 1
            is_dir = not is_empty_file
        a = attrs[i]
        if a is not None and (a & 0x10):
            is_dir = True
        files.append({"name": names[i], "dir": is_dir, "stream": has_stream})
    return files


def coder_filter(cid, props):
    """Return (kind, filters) for python lzma raw or a callable factory."""
    if cid == b"\x21":
        p = props[0]
        dict_size = 0xFFFFFFFF if p == 40 else (2 | (p & 1)) << (p // 2 + 11)
        return [{"id": lzma.FILTER_LZMA2, "dict_size": dict_size}]
    if cid == b"\x03\x01\x01":
        b0 = props[0]
        lc = b0 % 9
        b0 //= 9
        lp = b0 % 5
        pb = b0 // 5
        dict_size = struct.unpack("<I", props[1:5])[0]
        return [{"id": lzma.FILTER_LZMA1, "dict_size": max(dict_size, 4096), "lc": lc, "lp": lp, "pb": pb}]
    if cid in (b"\x03", ):
        return [{"id": lzma.FILTER_DELTA, "dist": (props[0] + 1) if props else 1}]
    if cid in (b"\x04", b"\x03\x03\x01\x03"):
        return [{"id": lzma.FILTER_X86}]
    if cid in (b"\x05", b"\x03\x03\x02\x05"):
        return [{"id": lzma.FILTER_POWERPC}]
    if cid in (b"\x06", b"\x03\x03\x04\x01"):
        return [{"id": lzma.FILTER_IA64}]
    if cid in (b"\x07", b"\x03\x03\x05\x01"):
        return [{"id": lzma.FILTER_ARM}]
    if cid in (b"\x08", b"\x03\x03\x07\x01"):
        return [{"id": lzma.FILTER_ARMTHUMB}]
    if cid in (b"\x09", b"\x03\x03\x08\x05"):
        return [{"id": lzma.FILTER_SPARC}]
    return None


def stage(chunks, cid, props):
    if cid == b"\x00":
        yield from chunks
        return
    if cid == b"\x04\x01\x08":
        d = zlib.decompressobj(-15)
        for c in chunks:
            out = d.decompress(c)
            if out:
                yield out
        out = d.flush()
        if out:
            yield out
        return
    if cid == b"\x04\x02\x02":
        d = bz2.BZ2Decompressor()
        for c in chunks:
            if d.eof:
                break
            out = d.decompress(c)
            if out:
                yield out
        return
    filt = coder_filter(cid, props)
    if filt is None:
        raise NotImplementedError("unsupported coder %s" % cid.hex())
    d = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=filt)
    for c in chunks:
        if d.eof:
            break
        out = d.decompress(c)
        if out:
            yield out


def pack_chunks(fh, offset, size):
    fh.seek(offset)
    left = size
    while left > 0:
        b = fh.read(min(CHUNK, left))
        if not b:
            raise EOFError("archive truncated")
        left -= len(b)
        yield b


def folder_stream(fh, folder, pack_offset, pack_size):
    if len(folder.packed) != 1:
        raise NotImplementedError("multi-input folder (BCJ2?) unsupported")
    # coder index lookup by stream index
    in_base, out_base = [], []
    ti = to = 0
    for c in folder.coders:
        in_base.append(ti)
        out_base.append(to)
        ti += c[1]
        to += c[2]
    cur = None
    for ci, c in enumerate(folder.coders):
        if in_base[ci] == folder.packed[0]:
            cur = ci
    if cur is None:
        raise ValueError("cannot find packed-stream coder")
    chunks = pack_chunks(fh, pack_offset, pack_size)
    order = []
    while True:
        order.append(cur)
        out_idx = out_base[cur]
        nxt = None
        for in_i, out_i in folder.bind:
            if out_i == out_idx:
                for ci2, c2 in enumerate(folder.coders):
                    if in_base[ci2] == in_i:
                        nxt = ci2
        if nxt is None:
            break
        cur = nxt
    for ci in order:
        cid, nin, nout, props = folder.coders[ci]
        if nin != 1 or nout != 1:
            raise NotImplementedError("complex coder %s" % cid.hex())
        chunks = stage(chunks, cid, props)
    return chunks, [folder.coders[i][0].hex() for i in order]


def open_archive(path):
    fh = open(path, "rb")
    head = fh.read(32)
    if head[:6] != SIG:
        raise ValueError("not a 7z archive")
    off, size, crc = struct.unpack("<QQI", head[12:32])
    fh.seek(32 + off)
    hdr = fh.read(size)
    if zlib.crc32(hdr) != crc:
        raise ValueError("header CRC mismatch")
    while True:
        r = R(hdr)
        t = r.num()
        if t == 1:
            break
        if t != 0x17:
            raise ValueError("unexpected header type %d" % t)
        si = read_streams_info(r)
        f = si["folders"][0]
        ch, _ = folder_stream(fh, f, 32 + si["pack_pos"], si["pack_sizes"][0])
        hdr = b"".join(ch)[:folder_unpack_size(f)]
    archive = {"streams": None, "files": []}
    while True:
        pid = r.num()
        if pid == 0:
            break
        if pid == 2:
            while True:
                q = r.num()
                if q == 0:
                    break
                r.read(r.num())
        elif pid == 3:
            read_streams_info(r)
        elif pid == 4:
            archive["streams"] = read_streams_info(r)
        elif pid == 5:
            archive["files"] = read_files_info(r)
        else:
            raise ValueError("bad Header prop %d" % pid)
    return fh, archive


def safe_join(root, name):
    name = name.replace("\\", "/")
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts) or name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        raise ValueError("unsafe path in archive: %r" % name)
    return os.path.join(root, *parts)


def iterate(fh, archive):
    """Yield (file_dict, data_chunk_iter) for each file in order."""
    si = archive["streams"]
    files = archive["files"]
    if si is None:
        for f in files:
            yield f, iter(())
        return
    counts, sizes = si["substreams"]
    pack_pos = 32 + si["pack_pos"]
    pack_offsets = []
    o = pack_pos
    for s in si["pack_sizes"]:
        pack_offsets.append(o)
        o += s
    fi = 0
    size_i = 0
    # map: stream-having files in order -> (folder, size)
    stream_files = [f for f in files if f["stream"]]
    sf_i = 0
    # emit non-stream files interleaved in order
    pending_nostream = [f for f in files if not f["stream"]]
    order = files
    # Build per-file size list
    file_sizes = {}
    k = 0
    for fo, c in enumerate(counts):
        for _ in range(c):
            file_sizes[id(stream_files[k])] = (fo, sizes[k])
            k += 1
    cur_folder = -1
    gen = None
    buf = bytearray()
    for f in files:
        if not f["stream"]:
            yield f, iter(())
            continue
        fo, sz = file_sizes[id(f)]
        if fo != cur_folder:
            cur_folder = fo
            folder = si["folders"][fo]
            gen, _ = folder_stream(fh, folder, pack_offsets[fo], si["pack_sizes"][fo])
            buf = bytearray()
        yield f, take(gen, buf, sz)


def take(gen, buf, n):
    left = n
    while left > 0:
        if not buf:
            try:
                buf.extend(next(gen))
            except StopIteration:
                raise EOFError("unexpected end of decoded stream")
        m = min(left, len(buf))
        yield bytes(buf[:m])
        del buf[:m]
        left -= m


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    cmd, path = sys.argv[1], sys.argv[2]
    fh, arc = open_archive(path)
    if cmd == "list":
        si = arc["streams"]
        if si:
            for i, f in enumerate(si["folders"]):
                print("folder", i, [c[0].hex() for c in f.coders], "unpack", folder_unpack_size(f))
        for f in arc["files"]:
            print(("D " if f["dir"] else "F ") + (f["name"] or ""))
        return 0
    if cmd == "extract":
        out = sys.argv[3]
        os.makedirs(out, exist_ok=True)
        total = 0
        for f, it in iterate(fh, arc):
            p = safe_join(out, f["name"])
            if f["dir"]:
                os.makedirs(p, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as w:
                for c in it:
                    w.write(c)
                    total += len(c)
        print("extracted", total, "bytes")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
