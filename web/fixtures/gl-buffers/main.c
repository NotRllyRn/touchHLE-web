// SPDX-License-Identifier: MPL-2.0
// Original GLES-style split-buffer rendering regression, no game data.
#define GL_GLEXT_PROTOTYPES 1
#include <SDL.h>
#include <GL/gl.h>
#include <GL/glext.h>
#include <stdio.h>
#include <stdlib.h>

static GLuint expected_binding;
static void check(const char *label) {
    unsigned char pixel[4] = {0};
    glFinish();
    glReadPixels(32, 32, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel);
    GLenum error = glGetError();
    GLint binding = -1;
    glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &binding);
    printf("%s pixel=%u,%u,%u,%u error=%x\n", label, pixel[0], pixel[1], pixel[2], pixel[3], error);
    if (error || pixel[1] < 250 || pixel[0] > 5 || pixel[2] > 5 || binding != (GLint)expected_binding) exit(1);
}
int main(void) {
    if (SDL_Init(SDL_INIT_VIDEO)) return 10;
#ifdef __EMSCRIPTEN__
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
#else
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 1);
#endif
    SDL_Window *w = SDL_CreateWindow("Split vertex buffers", 0, 0, 64, 64, SDL_WINDOW_OPENGL);
    if (!w || !SDL_GL_CreateContext(w)) return 11;
    glViewport(0, 0, 64, 64);
    glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE); glDisable(GL_LIGHTING);
    glMatrixMode(GL_PROJECTION); glLoadIdentity();
    glMatrixMode(GL_MODELVIEW); glLoadIdentity();
    glClearColor(0,0,0,1);
    const GLfloat positions[] = {-1,-1, 3,-1, -1,3};
    const GLfloat colors[] = {0,1,0,1, 0,1,0,1, 0,1,0,1};
    const GLfloat interleaved[] = {-1,-1,0,1,0,1, 3,-1,0,1,0,1, -1,3,0,1,0,1};
    GLuint buffers[3]; glGenBuffers(3,buffers);
    glEnableClientState(GL_VERTEX_ARRAY);glEnableClientState(GL_COLOR_ARRAY);
    glBindBuffer(GL_ARRAY_BUFFER,buffers[2]);glBufferData(GL_ARRAY_BUFFER,sizeof(interleaved),interleaved,GL_STATIC_DRAW);
    expected_binding = buffers[2];
    glVertexPointer(2,GL_FLOAT,24,(void*)0);glColorPointer(4,GL_FLOAT,24,(void*)8);
    glClear(GL_COLOR_BUFFER_BIT);glDrawArrays(GL_TRIANGLES,0,3);check("interleaved control");
    glBindBuffer(GL_ARRAY_BUFFER,0);expected_binding = 0;
    glClear(GL_COLOR_BUFFER_BIT);glDrawArrays(GL_TRIANGLES,0,3);check("interleaved after unbind");
    glBindBuffer(GL_ARRAY_BUFFER,buffers[2]);expected_binding = buffers[2];
    glClear(GL_COLOR_BUFFER_BIT);glDrawArrays(GL_TRIANGLES,0,3);check("interleaved after rebind without new pointers");
    glBindBuffer(GL_ARRAY_BUFFER,buffers[0]);glBufferData(GL_ARRAY_BUFFER,sizeof(positions),positions,GL_STATIC_DRAW);
    glVertexPointer(2,GL_FLOAT,0,(void*)0);
    glBindBuffer(GL_ARRAY_BUFFER,buffers[1]);glBufferData(GL_ARRAY_BUFFER,sizeof(colors),colors,GL_STATIC_DRAW);
    expected_binding = buffers[1];
    glColorPointer(4,GL_FLOAT,0,(void*)0);
    glClear(GL_COLOR_BUFFER_BIT);glDrawArrays(GL_TRIANGLES,0,3);check("split buffers");
    glBindBuffer(GL_ARRAY_BUFFER,0);
    expected_binding = 0;
    glClear(GL_COLOR_BUFFER_BIT);glDrawArrays(GL_TRIANGLES,0,3);check("binding changed after pointers");

    GLuint indices;
    const GLushort index_data[] = {0,1,2, 0,1,2};
    glGenBuffers(1,&indices);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,indices);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof(index_data),index_data,GL_STATIC_DRAW);
    glClear(GL_COLOR_BUFFER_BIT);glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,0);check("indexed split buffers");
    glDrawArrays(GL_TRIANGLES,0,0);check("zero-count preserves binding");

    // Exercise normal and texture-coordinate locations, padded offsets and
    // independent strides, as used by an animated mesh with static UVs.
    const GLfloat padded_positions[] = {99,99, -1,-1, 3,-1, -1,3};
    const GLfloat padded_uvs[] = {99,99, .75,.75, 99,99,.75,.75, 99,99,.75,.75};
    const GLfloat normals[] = {0,0,1, 0,0,1, 0,0,1};
    const GLubyte pixels[] = {255,0,0,255, 0,0,255,255, 255,255,0,255, 0,255,0,255};
    GLuint texture;glGenTextures(1,&texture);glBindTexture(GL_TEXTURE_2D,texture);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,2,2,0,GL_RGBA,GL_UNSIGNED_BYTE,pixels);
    glEnable(GL_TEXTURE_2D);glTexEnvi(GL_TEXTURE_ENV,GL_TEXTURE_ENV_MODE,GL_MODULATE);
    glDisableClientState(GL_COLOR_ARRAY);glEnableClientState(GL_TEXTURE_COORD_ARRAY);
    glEnableClientState(GL_NORMAL_ARRAY);
    glBindBuffer(GL_ARRAY_BUFFER,buffers[0]);glBufferData(GL_ARRAY_BUFFER,sizeof(padded_positions),padded_positions,GL_STATIC_DRAW);
    glVertexPointer(2,GL_FLOAT,8,(void*)8);
    glBindBuffer(GL_ARRAY_BUFFER,buffers[1]);glBufferData(GL_ARRAY_BUFFER,sizeof(padded_uvs),padded_uvs,GL_STATIC_DRAW);
    glTexCoordPointer(2,GL_FLOAT,16,(void*)8);
    glBindBuffer(GL_ARRAY_BUFFER,buffers[2]);glBufferData(GL_ARRAY_BUFFER,sizeof(normals),normals,GL_STATIC_DRAW);
    glNormalPointer(GL_FLOAT,12,0);
    const GLfloat white[] = {1,1,1,1};
    glMaterialfv(GL_FRONT_AND_BACK,GL_DIFFUSE,white);
    glEnable(GL_LIGHTING);glEnable(GL_LIGHT0);
    expected_binding = buffers[2];
    glClear(GL_COLOR_BUFFER_BIT);glDrawElements(GL_TRIANGLES,3,GL_UNSIGNED_SHORT,0);check("textured mesh with three buffers");
    glDisable(GL_LIGHTING);glDisable(GL_LIGHT0);glDisable(GL_TEXTURE_2D);
    glDisableClientState(GL_TEXTURE_COORD_ARRAY);glDisableClientState(GL_NORMAL_ARRAY);
    glEnableClientState(GL_COLOR_ARRAY);
    glBindBuffer(GL_ARRAY_BUFFER,0);expected_binding = 0;
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,0);
    glVertexPointer(2,GL_FLOAT,24,interleaved);glColorPointer(4,GL_FLOAT,24,interleaved+2);
    glClear(GL_COLOR_BUFFER_BIT);glDrawArrays(GL_TRIANGLES,0,3);check("client memory after VBO draws");
    glDeleteTextures(1,&texture);glDeleteBuffers(1,&indices);
    glDeleteBuffers(3,buffers);SDL_DestroyWindow(w);SDL_Quit();puts("PASS split buffer fixture");return 0;
}
