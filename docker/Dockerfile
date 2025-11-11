# Use the base image with Node.js
FROM node:22.19-alpine
RUN apk add --update --no-cache openssh-client git
# Copy the current directory into the Docker image
COPY . /challenge-api

# Set working directory for future use
WORKDIR /challenge-api

# Install the dependencies from package.json
RUN npm i -g pnpm
RUN pnpm install

# Enable Node diagnostic reports and Prisma backtraces for deeper crash insights
ENV NODE_OPTIONS="--report-on-fatalerror --report-uncaught-exception --report-signal=SIGUSR2 --report-directory=/challenge-api/reports --report-filename=report.%p.%t.json --enable-source-maps"
ENV RUST_BACKTRACE=1
# Optional: raise Prisma log level from the engine; keep it modest by default
ENV PRISMA_LOG_LEVEL=info

RUN mkdir -p /challenge-api/reports

RUN echo "Running database migrations..."
RUN npx prisma migrate deploy

CMD ["node","/challenge-api/app.js"]
