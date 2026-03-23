# Build amd64
#docker buildx build --platform linux/amd64 -t myimage:amd64 --push .
# Build arm64
#docker buildx build --platform linux/arm64 -t myimage:arm64 --push .
# Combine into multi-arch manifest
docker buildx imagetools create --push -t anylogco/remote-gui:beta anylogco/remote-gui:amd64 anylogco/remote-gui:arm64
# docker buildx imagetools create --push -t anylogco/remote-gui:beta myimage:amd64 myimage:arm64
