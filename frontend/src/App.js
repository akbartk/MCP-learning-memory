import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Grid, 
  Paper, 
  Typography, 
  Box,
  Card,
  CardContent,
  LinearProgress,
  Chip,
  Alert
} from '@mui/material';
import { 
  CheckCircle, 
  Error, 
  Warning,
  Storage,
  Speed,
  Memory
} from '@mui/icons-material';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function App() {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [healthRes, metricsRes] = await Promise.all([
        axios.get(`${API_URL}/api/v1/health`),
        axios.get(`${API_URL}/api/v1/metrics`)
      ]);
      setHealth(healthRes.data);
      setMetrics(metricsRes.data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch data from API');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle color="success" />;
      case 'degraded':
        return <Warning color="warning" />;
      default:
        return <Error color="error" />;
    }
  };

  const getServiceStatus = (service) => {
    return service ? 'Online' : 'Offline';
  };

  const getServiceColor = (service) => {
    return service ? 'success' : 'error';
  };

  if (loading) {
    return (
      <Box sx={{ width: '100%', mt: 4 }}>
        <LinearProgress />
        <Typography align="center" sx={{ mt: 2 }}>Loading dashboard...</Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h3" gutterBottom align="center">
        MCP Server Monitoring Dashboard
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* System Health */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" mb={2}>
              {health && getStatusIcon(health.status)}
              <Typography variant="h5" sx={{ ml: 1 }}>
                System Health: {health?.status || 'Unknown'}
              </Typography>
            </Box>
            
            <Grid container spacing={2}>
              {health?.services && Object.entries(health.services).map(([service, status]) => (
                <Grid item xs={12} sm={6} md={3} key={service}>
                  <Card>
                    <CardContent>
                      <Typography color="textSecondary" gutterBottom>
                        {service.toUpperCase()}
                      </Typography>
                      <Chip 
                        label={getServiceStatus(status)}
                        color={getServiceColor(status)}
                        size="small"
                      />
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>

        {/* Performance Metrics */}
        {metrics && (
          <>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Box display="flex" alignItems="center" mb={2}>
                  <Speed color="primary" />
                  <Typography variant="h6" sx={{ ml: 1 }}>
                    Performance
                  </Typography>
                </Box>
                <Typography variant="h4">
                  {metrics.queries_per_second?.toFixed(2) || 0}
                </Typography>
                <Typography color="textSecondary">
                  Queries/Second
                </Typography>
                <Box mt={2}>
                  <Typography variant="body2">
                    Avg Response Time
                  </Typography>
                  <Typography variant="h6">
                    {metrics.average_response_time_ms?.toFixed(2) || 0} ms
                  </Typography>
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Box display="flex" alignItems="center" mb={2}>
                  <Memory color="primary" />
                  <Typography variant="h6" sx={{ ml: 1 }}>
                    Cache Performance
                  </Typography>
                </Box>
                <Typography variant="h4">
                  {((metrics.cache_hit_rate || 0) * 100).toFixed(1)}%
                </Typography>
                <Typography color="textSecondary">
                  Cache Hit Rate
                </Typography>
                <Box mt={2}>
                  <Typography variant="body2">
                    Active Sessions
                  </Typography>
                  <Typography variant="h6">
                    {metrics.active_sessions || 0}
                  </Typography>
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Box display="flex" alignItems="center" mb={2}>
                  <Storage color="primary" />
                  <Typography variant="h6" sx={{ ml: 1 }}>
                    Storage
                  </Typography>
                </Box>
                <Typography variant="h4">
                  {metrics.storage_used_gb?.toFixed(2) || 0} GB
                </Typography>
                <Typography color="textSecondary">
                  Storage Used
                </Typography>
                <Box mt={2}>
                  <Typography variant="body2">
                    Period
                  </Typography>
                  <Typography variant="h6">
                    {metrics.period || 'day'}
                  </Typography>
                </Box>
              </Paper>
            </Grid>
          </>
        )}

        {/* Timestamp */}
        <Grid item xs={12}>
          <Typography variant="body2" color="textSecondary" align="center">
            Last Updated: {health?.timestamp ? new Date(health.timestamp).toLocaleString() : 'Never'}
          </Typography>
        </Grid>
      </Grid>
    </Container>
  );
}

export default App;