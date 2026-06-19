FROM nginx:alpine

COPY login.html     /usr/share/nginx/html/login.html
COPY dashboard.html /usr/share/nginx/html/dashboard.html
COPY admin.html     /usr/share/nginx/html/admin.html
COPY nginx.conf     /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
