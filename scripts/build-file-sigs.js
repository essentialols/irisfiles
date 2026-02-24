#!/usr/bin/env node
/**
 * Build script: generates data/file-signatures.json
 * Downloads s0md3v's signature database, normalizes, supplements with
 * additional formats, and outputs a curated JSON file.
 *
 * Run once: node scripts/build-file-sigs.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'file-signatures.json');
const S0MD3V_URL = 'https://raw.githubusercontent.com/s0md3v/dump/master/static/file-signatures.json';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// Category guesser based on extension + description
function guessCategory(ext, desc) {
  const d = (desc || '').toLowerCase();
  const e = (ext || '').toLowerCase();
  if (/image|photo|picture|bitmap|icon|graphic|raster/.test(d) || /^(jpg|jpeg|png|gif|bmp|tiff|tif|ico|psd|ai|eps|svg|webp|avif|heic|heif|raw|cr2|nef|arw|dng|xcf|pcx|tga|ppm|pgm|pbm|xbm|xpm|jxl|jp2)$/.test(e)) return 'Image';
  if (/audio|sound|music|sample/.test(d) || /^(mp3|wav|ogg|flac|aac|m4a|wma|aiff|aif|mid|midi|opus|ape|mka|ra|amr|ac3)$/.test(e)) return 'Audio';
  if (/video|movie|film|animation/.test(d) || /^(mp4|avi|mkv|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|3g2|ts|m2ts|vob|ogv|rm|rmvb|asf|swf)$/.test(e)) return 'Video';
  if (/document|word|text|pdf|spreadsheet|presentation|office|rtf|epub|ebook/.test(d) || /^(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|epub|mobi|djvu|pages|numbers|key|tex|latex|csv|tsv|txt|md|html|htm|xml|json|yaml|yml)$/.test(e)) return 'Document';
  if (/archive|compress|zip|tar|gzip|bzip|7z|rar|cab/.test(d) || /^(zip|rar|7z|tar|gz|bz2|xz|lz|lzma|cab|arj|ace|lha|lzh|zst|z|sit|sitx|cpio|rpm|deb|ar|iso|dmg|img|wim|squashfs)$/.test(e)) return 'Archive';
  if (/executable|binary|program|library|dll|\.exe|windows pe|mach-o/.test(d) || /^(exe|dll|so|dylib|sys|com|msi|elf|bin|class|dex|apk|app|xbe)$/.test(e)) return 'Executable';
  if (/font|typeface|truetype|opentype|woff/.test(d) || /^(ttf|otf|woff|woff2|eot|pfb|pfm)$/.test(e)) return 'Font';
  if (/database|sqlite|mysql|mdb|access/.test(d) || /^(db|sqlite|sqlite3|mdb|accdb|dbf|frm|myd|myi)$/.test(e)) return 'Database';
  if (/disk image|iso 9660|dmg|partition|boot|filesystem/.test(d) || /^(iso|dmg|img|vhd|vhdx|vmdk|vdi|qcow|qcow2|toast|cue|bin|nrg|mdf|mds)$/.test(e)) return 'Disk Image';
  if (/system|firmware|bios|driver|registry|swap|dump|core/.test(d) || /^(sys|drv|fw|rom|efi)$/.test(e)) return 'System';
  if (/3d|model|mesh|scene|blender|obj|stl|fbx|gltf|collada/.test(d) || /^(obj|stl|fbx|gltf|glb|3ds|blend|dae|ply|wrl|step|stp|iges|igs|3mf|usd|usda|usdc|usdz)$/.test(e)) return '3D Model';
  if (/cad|drawing|autocad|solidworks|design/.test(d) || /^(dwg|dxf|dgn|shp|sldprt|sldasm|ipt|iam|catpart|par|step|iges)$/.test(e)) return 'CAD';
  if (/source|code|script|program|compiled|bytecode/.test(d) || /^(py|js|ts|c|cpp|h|java|rb|go|rs|swift|kt|cs|php|pl|sh|bat|ps1|lua|r|m|asm|wasm)$/.test(e)) return 'Code';
  if (/data|config|log|dump|capture|packet|pcap/.test(d) || /^(dat|log|cfg|ini|conf|pcap|pcapng|cap|csv|tsv|parquet|avro|protobuf)$/.test(e)) return 'Data';
  return 'Other';
}

// Hand-curated supplements (formats NOT in s0md3v or needing better metadata)
const SUPPLEMENTS = [
  // Images
  { magic: '89504E47', offset: 0, ext: ['png'], label: 'PNG Image', category: 'Image', description: 'Portable Network Graphics, a lossless raster image format' },
  { magic: 'FFD8FFE0', offset: 0, ext: ['jpg', 'jpeg'], label: 'JPEG Image (JFIF)', category: 'Image', description: 'JPEG image with JFIF metadata' },
  { magic: 'FFD8FFE1', offset: 0, ext: ['jpg', 'jpeg'], label: 'JPEG Image (Exif)', category: 'Image', description: 'JPEG image with Exif metadata' },
  { magic: 'FFD8FFDB', offset: 0, ext: ['jpg', 'jpeg'], label: 'JPEG Image', category: 'Image', description: 'JPEG image (raw quantization table)' },
  { magic: 'FFD8FFEE', offset: 0, ext: ['jpg', 'jpeg'], label: 'JPEG Image (Adobe)', category: 'Image', description: 'JPEG image with Adobe metadata' },
  { magic: '47494638', offset: 0, ext: ['gif'], label: 'GIF Image', category: 'Image', description: 'Graphics Interchange Format, supports animation and transparency' },
  { magic: '424D', offset: 0, ext: ['bmp', 'dib'], label: 'BMP Image', category: 'Image', description: 'Windows bitmap image' },
  { magic: '49492A00', offset: 0, ext: ['tif', 'tiff'], label: 'TIFF Image (LE)', category: 'Image', description: 'Tagged Image File Format, little-endian byte order' },
  { magic: '4D4D002A', offset: 0, ext: ['tif', 'tiff'], label: 'TIFF Image (BE)', category: 'Image', description: 'Tagged Image File Format, big-endian byte order' },
  { magic: '00000100', offset: 0, ext: ['ico'], label: 'ICO Icon', category: 'Image', description: 'Windows icon file' },
  { magic: '52494646', offset: 0, ext: ['webp'], label: 'RIFF Container', category: 'Image', description: 'RIFF container (WebP, WAV, AVI)' },
  { magic: '57454250', offset: 8, ext: ['webp'], label: 'WebP Image', category: 'Image', description: 'WebP image format by Google' },
  { magic: '38425053', offset: 0, ext: ['psd', 'psb'], label: 'Adobe Photoshop', category: 'Image', description: 'Adobe Photoshop document with layers and effects' },
  { magic: '67696D70', offset: 0, ext: ['xcf'], label: 'GIMP Image', category: 'Image', description: 'GIMP native image format with layers' },
  { magic: 'FF0A', offset: 0, ext: ['jxl'], label: 'JPEG XL', category: 'Image', description: 'JPEG XL, next-generation image format' },
  { magic: '0000000C6A502020', offset: 0, ext: ['jp2', 'j2k'], label: 'JPEG 2000', category: 'Image', description: 'JPEG 2000 image, wavelet-based compression' },
  { magic: '762F3101', offset: 0, ext: ['exr'], label: 'OpenEXR', category: 'Image', description: 'OpenEXR high dynamic range image' },
  { magic: '4949BC', offset: 0, ext: ['jxr', 'hdp', 'wdp'], label: 'JPEG XR', category: 'Image', description: 'JPEG XR (HD Photo), Microsoft HDR image format' },
  { magic: '50350A', offset: 0, ext: ['pgm', 'pbm', 'ppm', 'pnm'], label: 'Netpbm Image', category: 'Image', description: 'Portable pixmap/graymap/bitmap format' },
  { magic: '00000200', offset: 0, ext: ['cur'], label: 'Windows Cursor', category: 'Image', description: 'Windows cursor file' },

  // Audio
  { magic: '494433', offset: 0, ext: ['mp3'], label: 'MP3 Audio', category: 'Audio', description: 'MPEG Layer 3 audio with ID3 metadata' },
  { magic: 'FFFB', offset: 0, ext: ['mp3'], label: 'MP3 Audio', category: 'Audio', description: 'MPEG Layer 3 audio (MPEG1 Layer3, no CRC)' },
  { magic: 'FFF3', offset: 0, ext: ['mp3'], label: 'MP3 Audio', category: 'Audio', description: 'MPEG Layer 3 audio (MPEG2 Layer3)' },
  { magic: '664C6143', offset: 0, ext: ['flac'], label: 'FLAC Audio', category: 'Audio', description: 'Free Lossless Audio Codec' },
  { magic: '4F676753', offset: 0, ext: ['ogg', 'oga', 'ogv', 'opus'], label: 'Ogg Container', category: 'Audio', description: 'Ogg multimedia container (Vorbis, Opus, Theora)' },
  { magic: '57415645', offset: 8, ext: ['wav'], label: 'WAV Audio', category: 'Audio', description: 'Waveform Audio, uncompressed PCM audio' },
  { magic: '464F524D', offset: 0, ext: ['aiff', 'aif'], label: 'AIFF Audio', category: 'Audio', description: 'Audio Interchange File Format (Apple)' },
  { magic: '4D546864', offset: 0, ext: ['mid', 'midi'], label: 'MIDI', category: 'Audio', description: 'Musical Instrument Digital Interface file' },
  { magic: '4D414320', offset: 0, ext: ['ape'], label: "Monkey's Audio", category: 'Audio', description: "Monkey's Audio lossless codec" },
  { magic: '774F4646', offset: 0, ext: ['woff'], label: 'WOFF Font', category: 'Font', description: 'Web Open Font Format' },
  { magic: '774F4632', offset: 0, ext: ['woff2'], label: 'WOFF2 Font', category: 'Font', description: 'Web Open Font Format 2.0, Brotli-compressed' },
  { magic: '23210A', offset: 0, ext: ['amr'], label: 'AMR Audio', category: 'Audio', description: 'Adaptive Multi-Rate audio codec' },
  { magic: '2E524D46', offset: 0, ext: ['rm', 'rmvb', 'ra'], label: 'RealMedia', category: 'Audio', description: 'RealMedia streaming audio/video' },

  // Video
  { magic: '1A45DFA3', offset: 0, ext: ['mkv', 'webm', 'mka', 'mks'], label: 'Matroska/WebM', category: 'Video', description: 'Matroska multimedia container (MKV, WebM)' },
  { magic: '667479706D703431', offset: 4, ext: ['mp4', 'm4v'], label: 'MP4 Video (mp41)', category: 'Video', description: 'MPEG-4 Part 14 video container' },
  { magic: '667479706D703432', offset: 4, ext: ['mp4', 'm4v'], label: 'MP4 Video (mp42)', category: 'Video', description: 'MPEG-4 Part 14 video container' },
  { magic: '6674797069736F6D', offset: 4, ext: ['mp4', 'm4v'], label: 'MP4 Video (isom)', category: 'Video', description: 'MPEG-4 Part 14 video, ISO base media' },
  { magic: '667479704D345620', offset: 4, ext: ['m4v'], label: 'M4V Video', category: 'Video', description: 'Apple MPEG-4 video (iTunes)' },
  { magic: '66747970', offset: 4, ext: ['mp4', 'm4a', 'm4v', 'mov', '3gp'], label: 'ISO Base Media', category: 'Video', description: 'ISO Base Media File (MP4, MOV, 3GP family)' },
  { magic: '6674797071742020', offset: 4, ext: ['mov'], label: 'QuickTime Movie', category: 'Video', description: 'Apple QuickTime movie container' },
  { magic: '464C5601', offset: 0, ext: ['flv'], label: 'Flash Video', category: 'Video', description: 'Adobe Flash Video container' },
  { magic: '000001BA', offset: 0, ext: ['mpg', 'mpeg', 'vob'], label: 'MPEG Video', category: 'Video', description: 'MPEG Program Stream (MPEG-1/2 video)' },
  { magic: '000001B3', offset: 0, ext: ['mpg', 'mpeg'], label: 'MPEG-1 Video', category: 'Video', description: 'MPEG-1 video stream' },
  { magic: '41564920', offset: 8, ext: ['avi'], label: 'AVI Video', category: 'Video', description: 'Audio Video Interleave container (Microsoft)' },
  { magic: '3026B275', offset: 0, ext: ['wmv', 'wma', 'asf'], label: 'Windows Media', category: 'Video', description: 'Advanced Systems Format (WMV, WMA, ASF)' },
  { magic: '465753', offset: 0, ext: ['swf'], label: 'Flash SWF', category: 'Video', description: 'Adobe Flash (Shockwave Flash) animation' },
  { magic: '435753', offset: 0, ext: ['swf'], label: 'Flash SWF (compressed)', category: 'Video', description: 'Adobe Flash compressed animation' },

  // Documents
  { magic: '25504446', offset: 0, ext: ['pdf'], label: 'PDF Document', category: 'Document', description: 'Portable Document Format' },
  { magic: 'D0CF11E0A1B11AE1', offset: 0, ext: ['doc', 'xls', 'ppt', 'msg', 'msi'], label: 'Microsoft OLE2', category: 'Document', description: 'Microsoft Office legacy format (DOC, XLS, PPT) or OLE2 compound document' },
  { magic: '7B5C72746631', offset: 0, ext: ['rtf'], label: 'RTF Document', category: 'Document', description: 'Rich Text Format document' },
  { magic: 'EFBBBF', offset: 0, ext: ['txt', 'csv', 'log'], label: 'UTF-8 Text', category: 'Document', description: 'Text file with UTF-8 byte order mark' },
  { magic: 'FFFE', offset: 0, ext: ['txt'], label: 'UTF-16 LE Text', category: 'Document', description: 'Text file with UTF-16 little-endian BOM' },
  { magic: 'FEFF', offset: 0, ext: ['txt'], label: 'UTF-16 BE Text', category: 'Document', description: 'Text file with UTF-16 big-endian BOM' },
  { magic: '41542654464F524D', offset: 0, ext: ['djvu', 'djv'], label: 'DjVu Document', category: 'Document', description: 'DjVu scanned document format' },

  // Archives
  { magic: '504B0304', offset: 0, ext: ['zip', 'jar', 'docx', 'xlsx', 'pptx', 'epub', 'apk', 'ipa', 'odt', 'ods', 'odp', 'xpi'], label: 'ZIP Archive', category: 'Archive', description: 'ZIP compressed archive (also used by Office documents, Java JARs, Android APKs, EPUB)' },
  { magic: '504B0506', offset: 0, ext: ['zip'], label: 'ZIP Archive (empty)', category: 'Archive', description: 'Empty ZIP archive' },
  { magic: '504B0708', offset: 0, ext: ['zip'], label: 'ZIP Archive (spanned)', category: 'Archive', description: 'Spanned ZIP archive' },
  { magic: '526172211A0700', offset: 0, ext: ['rar'], label: 'RAR Archive (v5)', category: 'Archive', description: 'RAR compressed archive, version 5' },
  { magic: '526172211A07', offset: 0, ext: ['rar'], label: 'RAR Archive', category: 'Archive', description: 'RAR compressed archive, version 1.5+' },
  { magic: '377ABCAF271C', offset: 0, ext: ['7z'], label: '7-Zip Archive', category: 'Archive', description: '7-Zip compressed archive with LZMA/LZMA2' },
  { magic: '1F8B', offset: 0, ext: ['gz', 'tgz'], label: 'Gzip Archive', category: 'Archive', description: 'Gzip compressed file or tarball' },
  { magic: '425A68', offset: 0, ext: ['bz2', 'tbz2'], label: 'Bzip2 Archive', category: 'Archive', description: 'Bzip2 compressed file' },
  { magic: 'FD377A585A00', offset: 0, ext: ['xz', 'txz'], label: 'XZ Archive', category: 'Archive', description: 'XZ compressed file (LZMA2)' },
  { magic: '28B52FFD', offset: 0, ext: ['zst', 'zstd'], label: 'Zstandard Archive', category: 'Archive', description: 'Zstandard compressed file (Facebook)' },
  { magic: '4C5A4950', offset: 0, ext: ['lz'], label: 'Lzip Archive', category: 'Archive', description: 'Lzip compressed file' },
  { magic: '1F9D', offset: 0, ext: ['z'], label: 'Unix Compress', category: 'Archive', description: 'Unix compress (.Z) file' },
  { magic: '1FA0', offset: 0, ext: ['z'], label: 'Unix Compress (LZH)', category: 'Archive', description: 'Unix compress with LZH algorithm' },
  { magic: '213C617263683E', offset: 0, ext: ['a', 'ar', 'deb'], label: 'AR/Deb Archive', category: 'Archive', description: 'Unix AR archive, also used by Debian .deb packages' },
  { magic: 'EDABEEDB', offset: 0, ext: ['rpm'], label: 'RPM Package', category: 'Archive', description: 'Red Hat Package Manager archive' },
  { magic: '7573746172', offset: 257, ext: ['tar'], label: 'TAR Archive', category: 'Archive', description: 'Tape archive, uncompressed' },
  { magic: '4D534346', offset: 0, ext: ['cab'], label: 'Cabinet Archive', category: 'Archive', description: 'Microsoft Cabinet compressed archive' },
  { magic: '535A4444', offset: 0, ext: ['sz'], label: 'Snappy Framed', category: 'Archive', description: 'Snappy framing format (Google compression)' },
  { magic: '4C5A4F00', offset: 0, ext: ['lzo'], label: 'LZO Archive', category: 'Archive', description: 'LZO compressed file' },

  // Executables
  { magic: '7F454C46', offset: 0, ext: ['elf', 'so', 'o', 'bin'], label: 'ELF Executable', category: 'Executable', description: 'Executable and Linkable Format, used on Linux and Unix systems' },
  { magic: '4D5A', offset: 0, ext: ['exe', 'dll', 'sys', 'drv', 'ocx', 'scr'], label: 'Windows Executable', category: 'Executable', description: 'MS-DOS/Windows executable (PE format)' },
  { magic: 'CAFEBABE', offset: 0, ext: ['class'], label: 'Java Class', category: 'Executable', description: 'Compiled Java bytecode class file' },
  { magic: 'FEEDFACE', offset: 0, ext: ['dylib', 'bundle', 'app'], label: 'Mach-O (32-bit)', category: 'Executable', description: 'macOS/iOS Mach-O binary (32-bit)' },
  { magic: 'FEEDFACF', offset: 0, ext: ['dylib', 'bundle', 'app'], label: 'Mach-O (64-bit)', category: 'Executable', description: 'macOS/iOS Mach-O binary (64-bit)' },
  { magic: 'CEFAEDFE', offset: 0, ext: ['dylib', 'bundle', 'app'], label: 'Mach-O (32-bit, rev)', category: 'Executable', description: 'macOS Mach-O binary (32-bit, reverse byte order)' },
  { magic: 'CFFAEDFE', offset: 0, ext: ['dylib', 'bundle', 'app'], label: 'Mach-O (64-bit, rev)', category: 'Executable', description: 'macOS Mach-O binary (64-bit, reverse byte order)' },
  { magic: 'CAFED00D', offset: 0, ext: ['fat'], label: 'Mach-O Universal', category: 'Executable', description: 'macOS universal binary (fat binary, multiple architectures)' },
  { magic: '6465780A', offset: 0, ext: ['dex'], label: 'Dalvik Executable', category: 'Executable', description: 'Android Dalvik bytecode (DEX)' },
  { magic: '00617363', offset: 0, ext: ['wasm'], label: 'WebAssembly', category: 'Executable', description: 'WebAssembly binary module' },
  { magic: '0061736D', offset: 0, ext: ['wasm'], label: 'WebAssembly', category: 'Executable', description: 'WebAssembly binary module' },
  { magic: '4C01', offset: 0, ext: ['obj'], label: 'COFF Object', category: 'Executable', description: 'Common Object File Format (x86)' },

  // Fonts
  { magic: '00010000', offset: 0, ext: ['ttf'], label: 'TrueType Font', category: 'Font', description: 'TrueType font file' },
  { magic: '4F54544F', offset: 0, ext: ['otf'], label: 'OpenType Font', category: 'Font', description: 'OpenType font with CFF outlines' },

  // Databases
  { magic: '53514C69746520666F726D6174203300', offset: 0, ext: ['sqlite', 'sqlite3', 'db'], label: 'SQLite Database', category: 'Database', description: 'SQLite database file' },
  { magic: '000100004D53', offset: 0, ext: ['mdb'], label: 'Access Database', category: 'Database', description: 'Microsoft Access database (Jet)' },
  { magic: '000100005374616E64617264204A6574', offset: 0, ext: ['mdb'], label: 'Access Database (Jet)', category: 'Database', description: 'Microsoft Access database (Standard Jet DB)' },

  // Disk Images
  { magic: '4344303031', offset: 32769, ext: ['iso'], label: 'ISO 9660', category: 'Disk Image', description: 'ISO 9660 CD/DVD disc image' },
  { magic: '78017801', offset: 0, ext: ['dmg'], label: 'Apple DMG', category: 'Disk Image', description: 'Apple Disk Image (zlib compressed)' },
  { magic: '636F6E6563746978', offset: 0, ext: ['vhd'], label: 'VHD Disk Image', category: 'Disk Image', description: 'Microsoft Virtual Hard Disk' },
  { magic: '7668646601', offset: 0, ext: ['vhdx'], label: 'VHDX Disk Image', category: 'Disk Image', description: 'Microsoft Virtual Hard Disk v2' },
  { magic: '4B444D', offset: 0, ext: ['vmdk'], label: 'VMDK Disk Image', category: 'Disk Image', description: 'VMware Virtual Machine Disk' },
  { magic: '3C3C3C204F7261636C6520564D', offset: 0, ext: ['vdi'], label: 'VDI Disk Image', category: 'Disk Image', description: 'VirtualBox Virtual Disk Image' },
  { magic: '514649FB', offset: 0, ext: ['qcow2', 'qcow'], label: 'QCOW2 Disk Image', category: 'Disk Image', description: 'QEMU Copy-On-Write disk image' },
  { magic: '584946', offset: 0, ext: ['xif'], label: 'XIF Image', category: 'Disk Image', description: 'ScanSoft Pagis extended image format' },

  // 3D Models
  { magic: '424C454E444552', offset: 0, ext: ['blend'], label: 'Blender File', category: '3D Model', description: 'Blender 3D project file' },
  { magic: '676C5446', offset: 0, ext: ['glb'], label: 'glTF Binary', category: '3D Model', description: 'GL Transmission Format binary (3D scenes)' },
  { magic: '2320424C454E444552', offset: 0, ext: ['blend'], label: 'Blender (header)', category: '3D Model', description: 'Blender 3D project with text header' },
  { magic: '23204F424A', offset: 0, ext: ['obj'], label: 'Wavefront OBJ', category: '3D Model', description: 'Wavefront 3D object file' },
  { magic: '736F6C6964', offset: 0, ext: ['stl'], label: 'STL (ASCII)', category: '3D Model', description: 'Stereolithography 3D model (ASCII format)' },

  // CAD
  { magic: '41433130', offset: 0, ext: ['dwg'], label: 'AutoCAD DWG', category: 'CAD', description: 'AutoCAD drawing file' },

  // System / Firmware
  { magic: 'CF84010000000000', offset: 0, ext: ['img'], label: 'Android Sparse Image', category: 'System', description: 'Android sparse filesystem image' },
  { magic: '414E4452', offset: 0, ext: ['img'], label: 'Android Boot Image', category: 'System', description: 'Android boot/recovery partition image' },
  { magic: 'D00DFEED', offset: 0, ext: ['dtb'], label: 'Device Tree Blob', category: 'System', description: 'Flattened Device Tree binary' },
  { magic: 'HSQS', offset: 0, ext: ['squashfs', 'sfs'], label: 'SquashFS', category: 'System', description: 'SquashFS compressed read-only filesystem' },
  { magic: '68737173', offset: 0, ext: ['squashfs', 'sfs'], label: 'SquashFS', category: 'System', description: 'SquashFS compressed read-only filesystem' },

  // Data / Capture
  { magic: 'D4C3B2A1', offset: 0, ext: ['pcap'], label: 'PCAP Capture', category: 'Data', description: 'Packet capture file (tcpdump/Wireshark)' },
  { magic: 'A1B2C3D4', offset: 0, ext: ['pcap'], label: 'PCAP Capture (BE)', category: 'Data', description: 'Packet capture file, big-endian' },
  { magic: '0A0D0D0A', offset: 0, ext: ['pcapng'], label: 'PCAP-NG Capture', category: 'Data', description: 'Next-generation packet capture (Wireshark)' },
  { magic: '4F5243', offset: 0, ext: ['orc'], label: 'Apache ORC', category: 'Data', description: 'Apache ORC columnar storage' },
  { magic: '50415231', offset: 0, ext: ['parquet'], label: 'Apache Parquet', category: 'Data', description: 'Apache Parquet columnar data format' },
  { magic: '4F626A01', offset: 0, ext: ['avro'], label: 'Apache Avro', category: 'Data', description: 'Apache Avro data serialization' },
  { magic: '04224D18', offset: 0, ext: ['lz4'], label: 'LZ4 Frame', category: 'Archive', description: 'LZ4 compressed frame' },

  // Apple-specific
  { magic: '62706C697374', offset: 0, ext: ['plist'], label: 'Binary Plist', category: 'Data', description: 'Apple binary property list' },
  { magic: '789C', offset: 0, ext: ['zlib'], label: 'Zlib Data', category: 'Data', description: 'Zlib compressed data stream' },
  { magic: '4170706C65', offset: 0, ext: ['aae'], label: 'Apple AAE Sidecar', category: 'Data', description: 'Apple photo edit sidecar (plist XML)' },

  // Email
  { magic: '4D424F58', offset: 0, ext: ['mbox'], label: 'Mailbox', category: 'Data', description: 'Unix mailbox file' },

  // Crypto / security
  { magic: '2D2D2D2D2D424547494E', offset: 0, ext: ['pem', 'crt', 'key'], label: 'PEM Certificate', category: 'Data', description: 'PEM-encoded certificate, key, or CSR' },

  // Other common
  { magic: '4353', offset: 0, ext: ['cs'], label: 'COFF Symbol Table', category: 'Other', description: 'COFF symbol table or C# source' },
];

async function main() {
  console.log('Fetching s0md3v database...');
  const raw = await fetch(S0MD3V_URL);
  const src = JSON.parse(raw);

  // Normalize s0md3v format: keys are hex with spaces, values are arrays of {extension, description}
  const entries = [];
  const seen = new Set(); // dedup by magic+ext

  for (const [hexSpaced, types] of Object.entries(src)) {
    const magic = hexSpaced.replace(/\s+/g, '').toUpperCase();
    for (const t of types) {
      const ext = (t.extension || '*').toLowerCase().replace(/^\./, '');
      const exts = ext === '*' ? [] : [ext];
      const desc = t.description || '';
      const key = magic + '|' + ext;
      if (seen.has(key)) continue;
      seen.add(key);

      const cat = guessCategory(ext, desc);
      // Generate a label from the description (first ~30 chars or so)
      let label = desc;
      if (label.length > 50) label = label.slice(0, 47) + '...';

      entries.push({
        magic,
        offset: 0,
        ext: exts,
        label,
        category: cat,
        description: desc
      });
    }
  }

  console.log(`Imported ${entries.length} entries from s0md3v`);

  // Add supplements, deduplicating by magic
  let added = 0;
  for (const s of SUPPLEMENTS) {
    const key = s.magic.toUpperCase() + '|' + s.ext[0];
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ ...s, magic: s.magic.toUpperCase() });
    added++;
  }
  console.log(`Added ${added} supplemental entries`);

  // Sort by category then label for readability
  entries.sort((a, b) => {
    const catOrder = ['Image', 'Audio', 'Video', 'Document', 'Archive', 'Executable', 'Font', 'Database', 'Disk Image', 'System', '3D Model', 'CAD', 'Code', 'Data', 'Other'];
    const ca = catOrder.indexOf(a.category);
    const cb = catOrder.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.label.localeCompare(b.label);
  });

  // Sort entries so longer magic bytes come first (more specific matches first)
  entries.sort((a, b) => {
    const catOrder = ['Image', 'Audio', 'Video', 'Document', 'Archive', 'Executable', 'Font', 'Database', 'Disk Image', 'System', '3D Model', 'CAD', 'Code', 'Data', 'Other'];
    const ca = catOrder.indexOf(a.category);
    const cb = catOrder.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    // Within same category, longer magic = more specific = first
    if (b.magic.length !== a.magic.length) return b.magic.length - a.magic.length;
    return a.label.localeCompare(b.label);
  });

  fs.writeFileSync(OUT, JSON.stringify(entries, null, 2));
  console.log(`Wrote ${entries.length} entries to ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
