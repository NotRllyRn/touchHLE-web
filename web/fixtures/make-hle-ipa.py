# SPDX-License-Identifier: MPL-2.0
"""Original tiny ARM Mach-O fixture: real dyld imports, puts(), and exit().
No Apple SDK, proprietary code, or canned emulator output is used.
"""
import pathlib
import plistlib
import struct
import sys
import zipfile


def words(*values):
    return struct.pack('<' + 'I' * len(values), *values)


def name(value):
    return value.encode().ljust(16, b'\0')


def segment(label, address, size, offset, file_size, protection, sections=b''):
    return (words(1, 56 + len(sections)) + name(label) +
            words(address, size, offset, file_size, protection, protection,
                  len(sections) // 68, 0) + sections)


text = bytearray(4096)
# Original ARM instructions and PC-relative literal loads. Exercise the
# zero-length/null memcpy contract before printing success.
instructions, literals = [], []
imports = ["puts", "exit", "memcpy"]
mapped = "--mapped" in sys.argv
buffers = "--buffers" in sys.argv or mapped
mipmap = "--mipmap" in sys.argv
combine = "--combine" in sys.argv or mipmap
points = "--points" in sys.argv
point_parameters = "--point-parameters" in sys.argv
fog = "--fog" in sys.argv
light_spot = "--light-spot" in sys.argv
light_attenuation = "--light-attenuation" in sys.argv or light_spot
lighting = "--lighting" in sys.argv or fog or light_attenuation
points = points or point_parameters
present_buffers = "--present-buffers" in sys.argv
present = "--present" in sys.argv or present_buffers
graphics = "--graphics" in sys.argv or buffers or present or combine or points or lighting
strings_data = {}
next_string = 0x1d00

def literal(register, value):
    literals.append((len(instructions), register, value))
    instructions.append(0)

def call(pointer):
    literal(12, pointer)
    instructions.extend([0xe59cc000, 0xe12fff3c]) # ldr r12,[r12]; blx r12

def call_symbol(symbol):
    if symbol not in imports:
        imports.append(symbol)
    call(0x2000 + imports.index(symbol) * 4)

def string(value):
    global next_string
    address = next_string
    strings_data[address] = value.encode() + b'\0'
    next_string += len(value) + 1
    return address

def selector(value):
    literal(0, string(value))
    call_symbol('sel_registerName')
    instructions.append(0xe1a01000) # r1 = selector

require_index = 0

def require(register, value, not_equal=False):
    global require_index
    require_index += 1
    if value <= 255:
        instructions.append(0xe3500000 | register << 16 | value) # cmp rn,#value
    else:
        literal(12, value)
        instructions.append(0xe150000c | register << 16) # cmp rn,r12
    instructions.append(0x1a000003 if not_equal else 0x0a000003)
    instructions.append(0xe3a00000 | require_index)
    call_symbol('exit')

if graphics:
    literal(0, 0x2f08)
    instructions.append(0xe5900000) # bound Objective-C class reference
    instructions.append(0xe1a04000) # r4 = class
    selector('alloc')
    instructions.append(0xe1a00004)
    call_symbol('objc_msgSend')
    instructions.append(0xe1a05000) # r5 = context
    selector('initWithAPI:')
    instructions.extend([0xe1a00005, 0xe3a02001])
    call_symbol('objc_msgSend')
    instructions.append(0xe1a05000)
    selector('setCurrentContext:')
    instructions.extend([0xe1a00004, 0xe1a02005])
    call_symbol('objc_msgSend')
    require(0, 1)
if graphics and not present:
    literal(0, 0x3f000000) # 0.5, soft-float guest ABI
    call_symbol('glClearDepthf')
    literal(0, 0x3e800000) # 0.25
    literal(1, 0x3f400000) # 0.75
    call_symbol('glDepthRangef')
    instructions.append(0xe3a00001)
    literal(1, 0x2f00)
    call_symbol('glGenRenderbuffersOES')
    literal(0, 0x8d41)
    literal(1, 0x2f00)
    instructions.append(0xe5911000)
    call_symbol('glBindRenderbufferOES')
    literal(0, 0x8d41)
    literal(1, 0x8058) # RGBA8
    instructions.extend([0xe3a02010, 0xe3a03010])
    call_symbol('glRenderbufferStorageOES')
    literal(0, 0x8d41)
    literal(1, 0x8d42) # RENDERBUFFER_WIDTH
    literal(2, 0x2f04)
    call_symbol('glGetRenderbufferParameterivOES')
    literal(0, 0x2f04)
    instructions.append(0xe5900000)
    require(0, 16)
    literal(0, 0x0de1) # TEXTURE_2D server state
    literal(1, 0x2f0c)
    call_symbol('glGetBooleanv')
    literal(0, 0x2300) # TEXTURE_ENV
    literal(1, 0x2200) # TEXTURE_ENV_MODE
    literal(2, 0x2f10)
    call_symbol('glGetTexEnviv')
    literal(0, 0x2300)
    literal(1, 0x2200)
    literal(2, 0x2f10)
    call_symbol('glTexEnviv')
    literal(0, 0x0d32) # MAX_CLIP_PLANES: adapter exposes exactly six
    literal(1, 0x2f14)
    call_symbol('glGetIntegerv')
    literal(0, 0x2f14)
    instructions.append(0xe5900000)
    require(0, 6)
    # Draw into a complete offscreen framebuffer, then verify an actual pixel.
    instructions.append(0xe3a00001)
    literal(1, 0x2f18)
    call_symbol('glGenFramebuffersOES')
    literal(0, 0x8d40)
    literal(1, 0x2f18)
    instructions.append(0xe5911000)
    call_symbol('glBindFramebufferOES')
    literal(0, 0x8d40)
    literal(1, 0x8ce0) # COLOR_ATTACHMENT0
    literal(2, 0x8d41)
    literal(3, 0x2f00)
    instructions.append(0xe5933000)
    call_symbol('glFramebufferRenderbufferOES')
    instructions.extend([0xe3a00000, 0xe3a01000, 0xe3a02010, 0xe3a03010])
    call_symbol('glViewport')
    literal(0, 0x3f800000)
    instructions.extend([0xe3a01000, 0xe3a02000])
    literal(3, 0x3f800000)
    call_symbol('glColor4f')
    literal(0, 0x8074) # VERTEX_ARRAY
    call_symbol('glEnableClientState')
    instructions.append(0xe3a00002)
    literal(1, 0x1406) # FLOAT
    instructions.append(0xe3a02000)
    literal(3, 0x1e00)
    call_symbol('glVertexPointer')
    if combine:
        # A matrix in the repeated sample expression used by texture COMBINE
        # previously made Emscripten generate syntactically invalid GLSL.
        instructions.append(0xe3a00001)
        literal(1, 0x2f30)
        call_symbol('glGenTextures')
        literal(0, 0x0de1)
        literal(1, 0x2f30)
        instructions.append(0xe5911000)
        call_symbol('glBindTexture')
        if mipmap:
            literal(0, 0x0de1)
            literal(1, 0x8191) # GENERATE_MIPMAP
            literal(2, 0x2f34)
            call_symbol('glGetTexParameteriv')
            literal(1, 0x2f34)
            instructions.append(0xe5910000)
            require(0, 0)
            literal(0, 0x0de1)
            literal(1, 0x8191)
            instructions.append(0xe3a02001)
            call_symbol('glTexParameteri')
            literal(0, 0x0de1)
            literal(1, 0x8191)
            literal(2, 0x2f34)
            call_symbol('glGetTexParameteriv')
            literal(1, 0x2f34)
            instructions.append(0xe5910000)
            require(0, 1)
        instructions.extend([0xe3a00002 if mipmap else 0xe3a00001, 0xe3a01000]) # height, border
        literal(2, 0x1908)
        literal(3, 0x1401)
        literal(4, 0x1f40 if mipmap else 0x1e60)
        instructions.append(0xe92d003f) # five stack arguments + padding
        literal(0, 0x0de1)
        instructions.append(0xe3a01000)
        literal(2, 0x1908)
        instructions.append(0xe3a03002 if mipmap else 0xe3a03001)
        call_symbol('glTexImage2D')
        instructions.append(0xe28dd018)
        literal(0, 0x0de1)
        literal(1, 0x2801)
        literal(2, 0x2703 if mipmap else 0x2600) # mipmap completeness or NEAREST
        call_symbol('glTexParameteri')
        literal(0, 0x0de1)
        call_symbol('glEnable')
        for pname, value in [(0x2200, 0x8570), (0x8571, 0x1e01)]:
            literal(0, 0x2300)
            literal(1, pname)
            literal(2, struct.unpack('<I', struct.pack('<f', value))[0])
            if pname == 0x2200:
                call_symbol('glTexEnvf')
            else:
                instructions.append(0xe92d000c) # scalar float vector on stack
                instructions.append(0xe1a0200d) # r2 = sp
                call_symbol('glTexEnvfv')
                instructions.append(0xe28dd008)
        literal(0, 0x1702)
        call_symbol('glMatrixMode')
        call_symbol('glLoadIdentity')
        literal(0, 0x8078)
        call_symbol('glEnableClientState')
        instructions.append(0xe3a00002)
        literal(1, 0x1406)
        instructions.append(0xe3a02000)
        literal(3, 0x1e40)
        call_symbol('glTexCoordPointer')
    if lighting:
        literal(0, 0x8075) # NORMAL_ARRAY
        call_symbol('glEnableClientState')
        literal(0, 0x1406)
        instructions.append(0xe3a01000)
        literal(2, 0x1ec0)
        call_symbol('glNormalPointer')
        for pname, pointer in [(0x1200, 0x1ea0), (0x1201, 0x1e90),
                               (0x1202, 0x1f00), (0x1601, 0x1e70),
                               (0x1600, 0x1ef0)]:
            literal(0, 0x0408) # FRONT_AND_BACK
            literal(1, pname)
            literal(2, pointer)
            call_symbol('glMaterialfv')
        literal(0, 0x0408)
        literal(1, 0x1601)
        literal(2, 0x40800000) # scalar float shininess 4
        call_symbol('glMaterialf')
        literal(0, 0x0408)
        literal(1, 0x1601)
        instructions.append(0xe3a02000) # fixed-point shininess 0
        call_symbol('glMaterialx')
        literal(0, 0x0b53) # LIGHT_MODEL_AMBIENT
        literal(1, 0x1ea0)
        call_symbol('glLightModelfv')
        literal(0, 0x4000)
        literal(1, 0x1201) # LIGHT0 diffuse white
        literal(2, 0x1eb0)
        call_symbol('glLightfv')
        for capability in [0x0b50, 0x4000]:
            literal(0, capability)
            call_symbol('glEnable')
        if light_attenuation:
            for pname, pointer in [(0x1200, 0x1eb0), (0x1201, 0x1ea0), (0x1202, 0x1ea0)]:
                literal(0, 0x0408)
                literal(1, pname)
                literal(2, pointer)
                call_symbol('glMaterialfv')
            for pname, pointer in [(0x1200, 0x1eb0), (0x1203, 0x1eb0)]:
                literal(0, 0x4000)
                literal(1, pname)
                literal(2, pointer)
                call_symbol('glLightfv')
            literal(0, 0x4000)
            literal(1, 0x1207) # constant attenuation 2
            literal(2, 0x40000000)
            call_symbol('glLightf')
            literal(0, 0x4000)
            literal(1, 0x1208) # linear attenuation 0, fixed variant
            instructions.append(0xe3a02000)
            call_symbol('glLightx')
            if light_spot:
                literal(0, 0x4000)
                literal(1, 0x1204) # spot points +Z, away from triangle
                literal(2, 0x1ec0)
                call_symbol('glLightfv')
                literal(0, 0x4000)
                literal(1, 0x1206)
                literal(2, 0x42b40000) # cutoff 90 degrees
                call_symbol('glLightf')
        if fog:
            literal(0, 0x0b65) # FOG_MODE is an enum, not 16.16
            literal(1, 0x2601) # LINEAR
            call_symbol('glFogx')
            literal(0, 0x0b63)
            literal(1, 0xc0000000) # start -2
            call_symbol('glFogf')
            literal(0, 0x0b64)
            literal(1, 0xffff0000) # end -1 in 16.16
            call_symbol('glFogx')
            literal(0, 0x0b66)
            literal(1, 0x1f00) # blue fog
            call_symbol('glFogfv')
            literal(0, 0x0b60)
            call_symbol('glEnable')
    instructions.extend([0xe3a00004, 0xe3a01000, 0xe3a02003]) # TRIANGLES
    call_symbol('glDrawArrays')
    if points:
        literal(0, 0x40000000) # 2.0 via the soft-float guest ABI
        call_symbol('glPointSize')
        literal(0, 0x0b11)
        literal(1, 0x2f38)
        call_symbol('glGetFloatv')
        literal(0, 0x2f38)
        instructions.append(0xe5900000)
        require(0, 0x40000000)
        literal(0, 4 << 16)
        call_symbol('glPointSizex')
        literal(0, 0x0b11)
        literal(1, 0x2f38)
        call_symbol('glGetFloatv')
        literal(0, 0x2f38)
        instructions.append(0xe5900000)
        require(0, 0x40800000)
        instructions.extend([0xe3a00000, 0xe3a01000])
        literal(2, 0x3f800000)
        literal(3, 0x3f800000)
        call_symbol('glColor4f')
        instructions.append(0xe3a00002)
        literal(1, 0x1406)
        instructions.append(0xe3a02000)
        literal(3, 0x1e70)
        call_symbol('glVertexPointer')
        instructions.extend([0xe3a00000, 0xe3a01000, 0xe3a02001]) # POINTS
        call_symbol('glDrawArrays')
        if point_parameters:
            # A new green point shrinks from four to two pixels under constant
            # attenuation. Query limits, then reset them to test attenuation
            # independently of clamping.
            literal(0, 0x8129)
            literal(1, 0x1e80)
            call_symbol('glPointParameterfv')
            literal(0, 0x8126)
            literal(1, 2 << 16)
            call_symbol('glPointParameterx')
            literal(0, 0x8127)
            literal(1, 0x40000000)
            call_symbol('glPointParameterf')
            literal(0, 0x8129)
            literal(1, 0x2f40)
            call_symbol('glGetFloatv')
            literal(0, 0x2f40)
            instructions.append(0xe5900000)
            require(0, 0x40800000)
            literal(0, 0x8127)
            literal(1, 0x2f40)
            call_symbol('glGetFloatv')
            literal(0, 0x2f40)
            instructions.append(0xe5900000)
            require(0, 0x40000000)
            for pname, value in [(0x8126, 0), (0x8127, 0x42800000)]:
                literal(0, pname)
                literal(1, value)
                call_symbol('glPointParameterf')
            instructions.append(0xe3a00000)
            literal(1, 0x3f800000)
            instructions.append(0xe3a02000)
            literal(3, 0x3f800000)
            call_symbol('glColor4f')
            instructions.extend([0xe3a00000, 0xe3a01000, 0xe3a02001])
            call_symbol('glDrawArrays')
    if buffers:
        # Exercise the indexed/VBO path used by game renderers as well as the
        # client-array path above. The second triangle must overwrite red blue.
        for target, slot, address, size in [(0x8892, 0x2f24, 0x1f20 if mapped else 0x1e00, 24),
                                            (0x8893, 0x2f28, 0x1e20, 6)]:
            instructions.append(0xe3a00001)
            literal(1, slot)
            call_symbol('glGenBuffers')
            literal(0, target)
            literal(1, slot)
            instructions.append(0xe5911000)
            call_symbol('glBindBuffer')
            literal(0, target)
            literal(1, size)
            literal(2, address)
            literal(3, 0x88e4) # STATIC_DRAW
            call_symbol('glBufferData')
        if mapped:
            for attempt in range(2):
                literal(0, 0x8892)
                literal(1, 0x88b9) # WRITE_ONLY_OES
                call_symbol('glMapBufferOES')
                require(0, 0, not_equal=True)
                instructions.append(0xe1a06000) # r6 = mapped guest pointer
                # Modify only the first x. The other vertices must survive
                # mapping for the final blue triangle to cover the test pixel.
                literal(0, 0xc0400000 if attempt == 0 else 0xc0000000)
                instructions.append(0xe5860000)
                literal(0, 0x8892)
                literal(1, 0x88bc) # BUFFER_MAPPED_OES
                literal(2, 0x2f38)
                call_symbol('glGetBufferParameteriv')
                literal(0, 0x2f38)
                instructions.append(0xe5900000)
                require(0, 1)
                if attempt == 0:
                    literal(0, 0x8892)
                    literal(1, 0x88b9)
                    call_symbol('glMapBufferOES')
                    require(0, 0) # duplicate map must fail
                    call_symbol('glGetError')
                    require(0, 0x0502)
                literal(0, 0x8892)
                call_symbol('glUnmapBufferOES')
                require(0, 1)
            literal(0, 0x8892)
            literal(1, 0x88bc)
            literal(2, 0x2f38)
            call_symbol('glGetBufferParameteriv')
            literal(0, 0x2f38)
            instructions.append(0xe5900000)
            require(0, 0)
        instructions.append(0xe3a00002)
        literal(1, 0x1406)
        instructions.extend([0xe3a02000, 0xe3a03000])
        call_symbol('glVertexPointer')
        instructions.extend([0xe3a00000, 0xe3a01000])
        literal(2, 0x3f800000)
        literal(3, 0x3f800000)
        call_symbol('glColor4f')
        instructions.extend([0xe3a00004, 0xe3a01003])
        literal(2, 0x1403) # UNSIGNED_SHORT
        instructions.append(0xe3a03000)
        call_symbol('glDrawElements')
    literal(0, 0x1908) # RGBA, UNSIGNED_BYTE, destination: stack arguments
    literal(1, 0x1401)
    literal(2, 0x2f20)
    instructions.append(0xe92d000f) # push r0-r3, keeping stack aligned
    instructions.extend([0xe3a00009 if points else 0xe3a00008, 0xe3a01008, 0xe3a02001, 0xe3a03001])
    call_symbol('glReadPixels')
    instructions.append(0xe28dd010) # add sp,sp,#16
    literal(1, 0x2f20)
    instructions.append(0xe5d10000) # red
    require(0, 0 if buffers or combine or points or fog or light_spot else 128 if light_attenuation else 255)
    literal(1, 0x2f20)
    instructions.append(0xe5d10001) # green
    require(0, 255 if lighting and not fog else 0)
    if buffers or combine or points or fog:
        literal(1, 0x2f20)
        instructions.append(0xe5d10002) # blue
        require(0, 255)
    elif lighting:
        literal(1, 0x2f20)
        instructions.append(0xe5d10002)
        require(0, 0 if light_spot else 128 if light_attenuation else 255)
    if points:
        if point_parameters:
            # The green two-pixel point covers x=7..8; x=9 stays blue.
            literal(0, 0x1908)
            literal(1, 0x1401)
            literal(2, 0x2f20)
            instructions.append(0xe92d000f)
            instructions.extend([0xe3a00008, 0xe3a01008, 0xe3a02001, 0xe3a03001])
            call_symbol('glReadPixels')
            instructions.append(0xe28dd010)
            literal(1, 0x2f20)
            instructions.append(0xe5d10001)
            require(0, 255)
            # Now clamp a much larger point. Without the max-size clamp it
            # would overwrite the red neighbor checked below.
            literal(0, 0x8127)
            literal(1, 0x40000000)
            call_symbol('glPointParameterf')
            literal(0, 0x42800000) # size 64, attenuated to 32, clamped to 2
            call_symbol('glPointSize')
            instructions.extend([0xe3a00000, 0xe3a01000, 0xe3a02001])
            call_symbol('glDrawArrays')
        # The four-pixel point covers x=6..9. Its neighbor must retain the
        # original red triangle, checking size rather than just any blue draw.
        literal(0, 0x1908)
        literal(1, 0x1401)
        literal(2, 0x2f20)
        instructions.append(0xe92d000f)
        instructions.extend([0xe3a0000a, 0xe3a01008, 0xe3a02001, 0xe3a03001])
        call_symbol('glReadPixels')
        instructions.append(0xe28dd010)
        literal(1, 0x2f20)
        instructions.append(0xe5d10000)
        require(0, 255)
        literal(1, 0x2f20)
        instructions.append(0xe5d10002)
        require(0, 0)
    if mipmap:
        instructions.extend([0xe3a00002, 0xe3a01002]) # width, height
        literal(2, 0x1908)
        literal(3, 0x1401)
        literal(4, 0x1f50)
        instructions.append(0xe92d003f)
        literal(0, 0x0de1)
        instructions.extend([0xe3a01000, 0xe3a02000, 0xe3a03000])
        call_symbol('glTexSubImage2D')
        instructions.append(0xe28dd018)
        instructions.extend([0xe3a00004, 0xe3a01000, 0xe3a02003])
        call_symbol('glDrawArrays')
        literal(0, 0x1908)
        literal(1, 0x1401)
        literal(2, 0x2f20)
        instructions.append(0xe92d000f)
        instructions.extend([0xe3a00008, 0xe3a01008, 0xe3a02001, 0xe3a03001])
        call_symbol('glReadPixels')
        instructions.append(0xe28dd010)
        literal(1, 0x2f20)
        instructions.append(0xe5d10000)
        require(0, 255)
        literal(1, 0x2f20)
        instructions.append(0xe5d10002)
        require(0, 0)
    call_symbol('glGetError')
    require(0, 0)

if present:
    # Full EAGL presentation, including copying the color renderbuffer to a
    # texture and drawing the host quad. Register r5 retains the EAGL context.
    def allocate(class_name, register):
        literal(0, {'UIWindow': 0x2f30, 'CAEAGLLayer': 0x2f34}[class_name])
        instructions.append(0xe5900000)
        instructions.append(0xe1a00000 | register << 12)
        selector('alloc')
        instructions.append(0xe1a00000 | register)
        call_symbol('objc_msgSend')
        instructions.append(0xe1a00000 | register << 12)

    def message_to(register, method):
        selector(method)
        instructions.append(0xe1a00000 | register)

    def frame(register, method):
        message_to(register, method)
        literal(2, 0x43a00000) # width 320
        literal(3, 0x43f00000) # height 480
        instructions.append(0xe92d000c) # push width,height
        instructions.extend([0xe3a02000, 0xe3a03000]) # origin
        call_symbol('objc_msgSend')
        instructions.append(0xe28dd008)

    allocate('UIWindow', 6)
    frame(6, 'initWithFrame:')
    message_to(6, 'setHidden:')
    instructions.append(0xe3a02000)
    call_symbol('objc_msgSend')
    message_to(6, 'layer')
    call_symbol('objc_msgSend')
    instructions.append(0xe1a06000) # r6 window's layer
    allocate('CAEAGLLayer', 7)
    message_to(7, 'init')
    call_symbol('objc_msgSend')
    frame(7, 'setFrame:')
    message_to(7, 'setOpaque:')
    instructions.append(0xe3a02001)
    call_symbol('objc_msgSend')
    message_to(6, 'addSublayer:')
    instructions.append(0xe1a02007)
    call_symbol('objc_msgSend')
    instructions.append(0xe3a00001)
    literal(1, 0x2f00)
    call_symbol('glGenRenderbuffersOES')
    literal(0, 0x8d41)
    literal(1, 0x2f00)
    instructions.append(0xe5911000)
    call_symbol('glBindRenderbufferOES')
    message_to(5, 'renderbufferStorage:fromDrawable:')
    literal(2, 0x8d41)
    instructions.append(0xe1a03007)
    call_symbol('objc_msgSend')
    require(0, 1)
    instructions.append(0xe3a00001)
    literal(1, 0x2f18)
    call_symbol('glGenFramebuffersOES')
    literal(0, 0x8d40)
    literal(1, 0x2f18)
    instructions.append(0xe5911000)
    call_symbol('glBindFramebufferOES')
    literal(0, 0x8d40)
    literal(1, 0x8ce0)
    literal(2, 0x8d41)
    literal(3, 0x2f00)
    instructions.append(0xe5933000)
    call_symbol('glFramebufferRenderbufferOES')
    literal(0, 0x3f800000)
    instructions.extend([0xe3a01000, 0xe3a02000])
    literal(3, 0x3f800000)
    call_symbol('glClearColor')
    literal(0, 0x4000)
    call_symbol('glClear')
    if present_buffers:
        instructions.append(0xe3a00001)
        literal(1, 0x2f24)
        call_symbol('glGenBuffers')
        literal(0, 0x8892)
        literal(1, 0x2f24)
        instructions.append(0xe5911000)
        call_symbol('glBindBuffer')
        literal(0, 0x8892)
        instructions.append(0xe3a01018)
        literal(2, 0x1e00)
        literal(3, 0x88e4)
        call_symbol('glBufferData')
        literal(0, 0x8074)
        call_symbol('glEnableClientState')
        instructions.append(0xe3a00002)
        literal(1, 0x1406)
        instructions.extend([0xe3a02000, 0xe3a03000])
        call_symbol('glVertexPointer')
    if not present_buffers:
        literal(0, 0x0de1)
        call_symbol('glEnable')
    message_to(5, 'presentRenderbuffer:')
    literal(2, 0x8d41)
    call_symbol('objc_msgSend')
    require(0, 1)
    if present_buffers:
        # Draw using the guest's VBO after EAGL has saved, changed and restored
        # array state. A missing binding makes this read host memory at zero.
        instructions.extend([0xe3a00000, 0xe3a01000])
        literal(2, 0x3f800000)
        literal(3, 0x3f800000)
        call_symbol('glColor4f')
        instructions.extend([0xe3a00004, 0xe3a01000, 0xe3a02003])
        call_symbol('glDrawArrays')
        literal(0, 0x808e) # VERTEX_ARRAY_POINTER must remain the VBO offset
        literal(1, 0x2f2c)
        call_symbol('glGetPointerv')
        literal(0, 0x2f2c)
        instructions.append(0xe5900000)
        require(0, 0)
        message_to(5, 'presentRenderbuffer:')
        literal(2, 0x8d41)
        call_symbol('objc_msgSend')
        require(0, 1)
    if not present_buffers:
        literal(0, 0x0de1)
        call_symbol('glIsEnabled')
        require(0, 1)
        literal(0, 0x0de1)
        literal(1, 0x2f0c)
        call_symbol('glGetBooleanv')
        literal(1, 0x2f0c)
        instructions.append(0xe5d10000)
        require(0, 1)
    # Read the window, not the guest renderbuffer, to verify presentation.
    literal(0, 0x8d40)
    instructions.append(0xe3a01000)
    call_symbol('glBindFramebufferOES')
    literal(0, 0x1908)
    literal(1, 0x1401)
    literal(2, 0x2f20)
    instructions.append(0xe92d000f)
    instructions.extend([0xe3a000a0, 0xe3a010f0, 0xe3a02001, 0xe3a03001])
    call_symbol('glReadPixels')
    instructions.append(0xe28dd010)
    literal(1, 0x2f20)
    instructions.append(0xe5d10000)
    require(0, 0 if present_buffers else 255)
    literal(1, 0x2f20)
    instructions.append(0xe5d10001)
    require(0, 0)
    if present_buffers:
        literal(1, 0x2f20)
        instructions.append(0xe5d10002)
        require(0, 255)
    call_symbol('glGetError')
    require(0, 0)

if not graphics:
    # Empty fills must not translate a null pointer, including checked memset.
    for symbol in ['memset', '__memset_chk']:
        instructions.extend([0xe3a00000, 0xe3a010ff, 0xe3a02000, 0xe3a03000])
        call_symbol(symbol)
        require(0, 0)
    literal(0, 8194)
    call_symbol('malloc')
    instructions.append(0xe1a04000) # r4 = allocation
    literal(1, 0x15a) # conversion to unsigned char
    literal(2, 8194)
    call_symbol('memset')
    instructions.append(0xe1500004) # cmp return pointer,r4
    instructions.append(0x13a00000) # movne r0,#0
    instructions.append(0x03a00001) # moveq r0,#1
    require(0, 1)
    instructions.extend([0xe2840001, 0xe3a010a5]) # unaligned interior
    literal(2, 8192)
    literal(3, 8192)
    call_symbol('__memset_chk')
    for offset, expected in [(0, 0x5a), (1, 0xa5), (4095, 0xa5),
                             (4096, 0xa5), (8192, 0xa5), (8193, 0x5a)]:
        literal(1, offset)
        instructions.append(0xe7d40001) # ldrb r0,[r4,r1]
        require(0, expected)
    instructions.append(0xe1a00004)
    call_symbol('free')

if '--memset-bench' in sys.argv:
    literal(0, 1048576)
    call_symbol('malloc')
    instructions.append(0xe1a04000)
    for marker in ['MEMSET_START', 'MEMSET_END']:
        literal(0, 0x2f00)
        instructions.append(0xe3a01000)
        call_symbol('gettimeofday')
        literal(0, string(marker + ' %u %u\n'))
        literal(3, 0x2f00)
        instructions.extend([0xe5931000, 0xe5932004])
        call_symbol('printf')
        if marker == 'MEMSET_START':
            literal(5, 100)
            loop=len(instructions)
            instructions.extend([0xe1a00004, 0xe3a010a5])
            literal(2, 1048576)
            call_symbol('memset')
            instructions.append(0xe2555001)
            instructions.append(0x1a000000 | ((loop-len(instructions)-2)&0xffffff))
    instructions.append(0xe1a00004)
    call_symbol('free')

instructions.extend([0xe3a00000, 0xe3a01000, 0xe3a02000]) # r0=r1=r2=0
call(0x2008) # memcpy(NULL, NULL, 0)
literal(0, 0x1c00)
call(0x2000) # puts
instructions.append(0xe3a00000)
call(0x2004) # exit(0)
instructions.append(0xeafffffe)
literal_pool = {}
for offset, register, value in literals:
    if value not in literal_pool:
        literal_pool[value] = len(instructions) * 4
        instructions.append(value)
    displacement = literal_pool[value] - (offset * 4 + 8)
    assert 0 <= displacement <= 4095
    instructions[offset] = 0xe59f0000 | register << 12 | displacement
code = words(*instructions)
message = b'PASS real touchHLE ARM guest called puts and exit\0'
text[0x200:0x200 + len(message)] = message
pointer_size = len(imports) * 4
section = name('__nl_symbol_ptr') + name('__DATA') + words(0x2000, pointer_size, 4096, 2, 0, 0, 6, 0, 0)
commands = [segment('__PAGEZERO', 0, 4096, 0, 0, 0),
            segment('__TEXT', 0x1000, 4096, 0, 4096, 5),
            segment('__DATA', 0x2000, 4096, 4096, pointer_size, 3, section)]
# Header/commands must not overlap code; entry is therefore moved to 0x1400.
text[0x400:0x400 + len(code)] = code
state = [0] * 17
state[15] = 0x1400
commands += [words(5, 84, 1, 17, *state)]
strings = bytearray(b'\0')
symbols = bytearray()
for symbol in imports:
    symbols += struct.pack('<IBBHI', len(strings), 1, 0, 0, 0)
    strings += ('_' + symbol).encode() + b'\0'
symbol_offset = 4096 + pointer_size
string_offset = symbol_offset + len(symbols)
commands += [words(2, 24, symbol_offset, len(imports), string_offset, len(strings))]
dysym = [0] * 18
dysym[4:6] = [0, len(imports)]
dysym[12:14] = [string_offset + len(strings), len(imports)]
commands += [words(11, 80, *dysym)]
bind = b''
if graphics:
    bind = b'\x40_OBJC_CLASS_$_EAGLContext\0\x51\x72\x88\x1e\x90\0'
    if present:
        bind = bind[:-1] + b'\x40_OBJC_CLASS_$_UIWindow\0\x51\x72\xb0\x1e\x90'
        bind += b'\x40_OBJC_CLASS_$_CAEAGLLayer\0\x51\x72\xb4\x1e\x90\0'
    bind_offset = string_offset + len(strings) + len(imports) * 4
    commands += [words(0x80000022, 48, 0, 0, bind_offset, len(bind), 0, 0, 0, 0, 0, 0)]
header = words(0xfeedface, 12, 6, 2, len(commands), sum(map(len, commands)), 0)
assert len(header) + sum(map(len, commands)) < 0x400
# Keep messages and constants beyond the expanded graphics fixture's code.
text[0xc00:0xc00 + len(message)] = message
text[0xe00:0xe18] = struct.pack('<6f', -1, -1, 3, -1, -1, 3)
text[0xe20:0xe26] = struct.pack('<3H', 0, 1, 2)
text[0xe40:0xe58] = struct.pack('<6f', 0, 0, 64 if mipmap else 1, 0, 0, 64 if mipmap else 1)
text[0xe60:0xe64] = bytes([0, 0, 255, 255])
text[0xe70:0xe78] = struct.pack('<2f', 0, 0)
text[0xe80:0xe8c] = struct.pack('<3f', 4, 0, 0)
text[0xe90:0xea0] = struct.pack('<4f', 1, 0, 0, 1)
text[0xea0:0xeb0] = struct.pack('<4f', 0, 0, 0, 1)
text[0xeb0:0xec0] = struct.pack('<4f', 1, 1, 1, 1)
text[0xec0:0xee4] = struct.pack('<9f', 0, 0, 1, 0, 0, 1, 0, 0, 1)
text[0xef0:0xf00] = struct.pack('<4f', 0, 1, 0, 1)
text[0xf00:0xf10] = struct.pack('<4f', 0, 0, 1, 1)
text[0xf40:0xf50] = bytes([0, 0, 255, 255]) * 4
text[0xf50:0xf60] = bytes([255, 0, 0, 255]) * 4
text[0xf20:0xf38] = struct.pack('<6f', 2, -1, 3, -1, 2, 3)
text[:len(header)] = header
text[len(header):len(header) + sum(map(len, commands))] = b''.join(commands)
for address, value in strings_data.items():
    text[address - 0x1000:address - 0x1000 + len(value)] = value
assert 0x400 + len(code) < 0xc00
binary = bytes(text) + bytes(pointer_size) + symbols + strings + words(*range(len(imports))) + bind
manifest = dict(CFBundleExecutable='BrowserTest', CFBundleIdentifier='org.touchhle.browser-test',
                CFBundleName='Browser HLE Test', CFBundleVersion='1.0', MinimumOSVersion='2.0')
fixture = 'mipmap' if mipmap else 'light-spot' if light_spot else 'light-attenuation' if light_attenuation else 'mapped' if mapped else 'fog' if fog else 'lighting' if lighting else 'point-parameters' if point_parameters else 'points' if points else 'combine' if combine else 'present-buffers' if present_buffers else 'present' if present else 'buffers' if buffers else 'graphics' if graphics else 'hle'
if '--memset-bench' in sys.argv:
    fixture = 'memset-bench'
output = pathlib.Path(__file__).resolve().parents[2] / f'target/browser-{fixture}-test.ipa'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('Payload/BrowserTest.app/Info.plist', plistlib.dumps(manifest))
    archive.writestr('Payload/BrowserTest.app/BrowserTest', binary)
print(output)
