# Serve website/ as static files. Build from repo root: docker build -f website/Dockerfile .
FROM nginx:alpine
COPY website/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
